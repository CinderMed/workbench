import type { Instance, MappingRow, ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import { buildIndex } from "./build-index.js";
import { FhirDefinitions } from "./definitions.js";
import { ReferenceCode, checkReferences } from "./references.js";
import { FHIR, sd } from "./test-support/synthetic-packages.js";

const reference = (min: number, ...targets: string[]) => ({
  min,
  type: [{ code: "Reference", ...(targets.length === 0 ? {} : { targetProfile: targets }) }],
});

const defs = (() => {
  const index = buildIndex("4.0.1", [
    {
      id: "hl7.fhir.r4.core",
      version: "4.0.1",
      fhirVersions: ["4.0.1"],
      resources: [
        sd("string", "primitive-type", { string: {} }),
        sd("Reference", "complex-type", {
          Reference: {},
          "Reference.reference": { type: [{ code: "string" }] },
        }),
        sd("Patient", "resource", { Patient: {} }),
        sd("Group", "resource", { Group: {} }),
        sd("Practitioner", "resource", { Practitioner: {} }),
        sd("Observation", "resource", {
          Observation: {},
          "Observation.subject": reference(0, `${FHIR}Patient`, `${FHIR}Group`),
          "Observation.focus": { ...reference(0), max: "*" },
          "Observation.partOf": reference(0, "http://example.org/StructureDefinition/not-loaded"),
          "Observation.note": { type: [{ code: "string" }] },
        }),
        sd("Condition", "resource", {
          Condition: {},
          "Condition.subject": reference(1, `${FHIR}Patient`, `${FHIR}Group`),
          "Condition.recorder": reference(0, `${FHIR}Practitioner`),
        }),
      ],
    },
  ]);
  if (!index.ok) throw new Error(JSON.stringify(index.issues));
  const opened = FhirDefinitions.open(index.value.manifest);
  if (!opened.ok) throw new Error("not opened");
  for (const [file, text] of index.value.files) opened.value.add(file, text);
  return opened.value;
})();

const role = (id: string, resourceType: string, index = 0): Instance => ({
  id,
  resourceType,
  index,
  label: id,
  sourceId: "src",
  multiplicity: { kind: "perRow" },
});
const ref = (n: number, from: string, path: string, to: string): MappingRow => ({
  id: `map_${String(n)}`,
  code: `R-00${String(n)}`,
  instanceId: from,
  path,
  transform: { kind: "reference", targetInstanceId: to },
});
function project(instances: Instance[], mappings: MappingRow[]): ProjectFile {
  return {
    formatVersion: "1.3.0",
    project: { id: "p", name: "p", fhirVersion: "4.0.1", canonicalBase: "http://example.org" },
    sources: [{ id: "src", name: "T", columns: [{ id: "c", name: "c", dataType: "string" }] }],
    instances,
    mappings,
    valueMaps: [],
  };
}
const check = (p: ProjectFile) =>
  checkReferences(p, defs, (instance) => instance.resourceType).map((r) => [
    r.severity,
    r.code,
    r.objectKind,
    r.id,
    r.field,
    r.message,
  ]);

describe("checkReferences", () => {
  const pat = role("pat", "Patient");
  const doc = role("doc", "Practitioner");
  const obs = role("obs", "Observation");

  it("accepts targets the element allows, and any target where it allows any", () => {
    expect(check(project([pat, obs], [ref(1, "obs", "subject", "pat")]))).toEqual([]);
    expect(check(project([doc, obs], [ref(1, "obs", "focus", "doc")]))).toEqual([]);
  });

  it("rejects a target of a type the element does not allow", () => {
    expect(check(project([doc, obs], [ref(1, "obs", "subject", "doc")]))).toEqual([
      [
        "error",
        ReferenceCode.REF_TARGET_NOT_ALLOWED,
        "mapping",
        "map_1",
        "transform.targetInstanceId",
        "R-001: Observation.subject allows Group, Patient, not Practitioner[0] (Practitioner)",
      ],
    ]);
  });

  it("warns when the element's target profiles are not in the definitions", () => {
    expect(check(project([pat, obs], [ref(1, "obs", "partOf", "pat")]))).toEqual([
      [
        "warning",
        ReferenceCode.REF_TARGET_NOT_ALLOWED,
        "mapping",
        "map_1",
        "transform.targetInstanceId",
        "R-001: Observation.partOf: target not checked: its target profiles (http://example.org/StructureDefinition/not-loaded) are not in the definitions",
      ],
    ]);
  });

  it("leaves paths that are not references, and roles of unknown types, to the other checks", () => {
    expect(
      check(project([pat, obs], [ref(1, "obs", "note", "pat"), ref(2, "obs", "nothing", "pat")])),
    ).toEqual([]);
    const unknown = checkReferences(
      project([pat, obs], [ref(1, "obs", "subject", "pat")]),
      defs,
      () => undefined,
    );
    expect(unknown).toEqual([]);
    expect(
      check(project([pat, obs], [ref(1, "obs", "subject", "missing")])).map((r) => r[1]),
    ).toEqual([ReferenceCode.ROLE_ORPHAN, ReferenceCode.ROLE_ORPHAN]);
  });

  it("warns about required references that nothing writes", () => {
    const cond = role("cond", "Condition");
    expect(
      check(project([pat, cond], [ref(1, "cond", "recorder", "pat")])).filter(
        (r) => r[1] !== ReferenceCode.REF_TARGET_NOT_ALLOWED,
      ),
    ).toEqual([
      [
        "warning",
        ReferenceCode.REFERENCE_REQUIRED_MISSING,
        "instance",
        "cond",
        "resourceType",
        "Condition[0]: Condition.subject is required (min 1), but no row writes it: the resource would be invalid",
      ],
    ]);
    const written = {
      ...ref(1, "cond", "subject.reference", "pat"),
      transform: { kind: "copy" as const },
      columnId: "c",
    };
    expect(check(project([pat, cond], [written, ref(2, "cond", "subject", "pat")]))).toEqual([]);
  });

  it("warns about roles nothing links, when there are several", () => {
    const other = role("pat2", "Patient", 1);
    expect(check(project([pat, obs, other], [ref(1, "obs", "subject", "pat")]))).toEqual([
      [
        "warning",
        ReferenceCode.ROLE_ORPHAN,
        "instance",
        "pat2",
        undefined,
        "Patient[1] (pat2) references no other role and no role references it",
      ],
    ]);
    expect(check(project([pat], []))).toEqual([]);
  });
});
