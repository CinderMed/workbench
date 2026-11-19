// Binding checks (D7, ADR-0016) on the real core packages, R4 4.0.1 and R5 5.0.0: the ValueSets
// of the core package, expanded offline. Runs when FHIR_CORE_PACKAGES=1 (the Unit tests job in CI).
import { beforeAll, describe, expect, it } from "vitest";
import { loadDefinitions } from "../apps/cli/src/fhir-packages.js";
import { type FhirDefinitions, validateFhir } from "../packages/fhir-defs/dist/index.js";
import type {
  Column,
  Instance,
  MappingRow,
  ProjectFile,
  ValueMap,
} from "../packages/model/dist/index.js";

const enabled = process.env["FHIR_CORE_PACKAGES"] === "1";

function project(
  fhirVersion: "4.0.1" | "5.0.0",
  instance: Instance,
  mappings: MappingRow[],
  valueMaps: ValueMap[] = [],
  columns: [Column, ...Column[]] = [{ id: "col", name: "c", dataType: "string" }],
): ProjectFile {
  return {
    formatVersion: "1.3.0",
    project: { id: "p", name: "p", fhirVersion, canonicalBase: "http://example.org/fhir" },
    sources: [{ id: "src", name: "T", columns }],
    instances: [instance],
    mappings,
    valueMaps,
  };
}
const role = (resourceType: string, extra: Partial<Instance> = {}): Instance => ({
  id: "ins",
  resourceType,
  index: 0,
  sourceId: "src",
  multiplicity: { kind: "perRow" },
  ...extra,
});
const constant = (path: string, value: MappingRow["transform"]): MappingRow => ({
  id: "map",
  code: "R-001",
  instanceId: "ins",
  path,
  transform: value,
});

describe.runIf(enabled).each(["4.0.1", "5.0.0"] as const)("bindings in FHIR %s", (fhirVersion) => {
  let defs: FhirDefinitions;
  beforeAll(async () => {
    defs = (await loadDefinitions(fhirVersion, [], { offline: true })).definitions;
  }, 300_000);
  const findings = (p: ProjectFile) =>
    validateFhir(p, defs)
      .filter((r) => r.code === "BINDING_VIOLATION")
      .map((r) => [r.severity, r.objectKind, r.field, r.message]);

  it("accepts codes in a required ValueSet, and rejects the others", () => {
    const gender: ValueMap = {
      id: "vm",
      name: "sex",
      target: "code",
      entries: [
        { sourceValue: "F", target: { value: "female" }, action: { kind: "use" } },
        { sourceValue: "M", target: { value: "M" }, action: { kind: "use" } },
        { sourceValue: "?", action: { kind: "absent" } },
      ],
    };
    const p = project(
      fhirVersion,
      role("Patient"),
      [{ ...constant("gender", { kind: "valueMap", valueMapId: "vm" }), columnId: "col" }],
      [gender],
      [
        {
          id: "col",
          name: "sex",
          dataType: "categorical",
          allowedValues: [{ code: "F" }, { code: "M" }, { code: "?" }],
        },
      ],
    );
    expect(findings(p)).toEqual([
      [
        "error",
        "valueMap",
        "entries.1.target",
        `R-001: Patient.gender: "M" (entry M) is not in the required ValueSet http://hl7.org/fhir/ValueSet/administrative-gender`,
      ],
    ]);
  });

  it("checks constants and the allowed values of a copied categorical column", () => {
    const status = (value: string) =>
      constant("status", { kind: "constant", value: { type: "code", value } });
    expect(findings(project(fhirVersion, role("Observation"), [status("final")]))).toEqual([]);
    expect(findings(project(fhirVersion, role("Observation"), [status("done")]))[0]).toEqual([
      "error",
      "mapping",
      "transform.value",
      `R-001: Observation.status: "done" (the value) is not in the required ValueSet http://hl7.org/fhir/ValueSet/observation-status`,
    ]);
    const copied = project(
      fhirVersion,
      role("Observation"),
      [{ ...constant("status", { kind: "copy" }), columnId: "col" }],
      [],
      [
        {
          id: "col",
          name: "st",
          dataType: "categorical",
          allowedValues: [{ code: "final" }, { code: "finished" }, { code: "NA" }],
          missingValues: ["NA"],
        },
      ],
    );
    expect(findings(copied)).toEqual([
      [
        "error",
        "mapping",
        "columnId",
        `R-001: Observation.status: "finished" (allowed value finished of column st) is not in the required ValueSet http://hl7.org/fhir/ValueSet/observation-status`,
      ],
    ]);
  });

  it("warns about codes outside a preferred or extensible ValueSet, and never checks examples", () => {
    // Condition.severity: a preferred binding to an enumerated SNOMED CT list, in R4 and R5.
    const severity = (code: string) =>
      constant("severity", {
        kind: "constant",
        value: { type: "CodeableConcept", coding: { system: "http://snomed.info/sct", code } },
      });
    expect(findings(project(fhirVersion, role("Condition"), [severity("24484000")]))).toEqual([]);
    const unknown = findings(project(fhirVersion, role("Condition"), [severity("1234")]));
    expect(unknown).toEqual([
      [
        "warning",
        "mapping",
        "transform.value",
        "R-001: Condition.severity: http://snomed.info/sct|1234 (the value) is not in the preferred ValueSet http://hl7.org/fhir/ValueSet/condition-severity",
      ],
    ]);
    // Observation.code has an example binding: any code is fine.
    const code = constant("code", {
      kind: "constant",
      value: { type: "CodeableConcept", coding: { system: "http://example.org", code: "x" } },
    });
    expect(findings(project(fhirVersion, role("Observation"), [code]))).toEqual([]);
  });

  it("warns when a required ValueSet cannot be expanded offline", () => {
    const contentType = constant("photo.contentType", {
      kind: "constant",
      value: { type: "code", value: "image/png" },
    });
    const result = findings(project(fhirVersion, role("Patient"), [contentType]));
    expect(result).toHaveLength(1);
    expect(result[0]?.[0]).toBe("warning");
    expect(result[0]?.[3]).toMatch(
      /^R-001: Patient\.photo\.contentType: binding not checked: the required ValueSet http:\/\/hl7\.org\/fhir\/ValueSet\/mimetypes cannot be expanded offline/,
    );
  });
});
