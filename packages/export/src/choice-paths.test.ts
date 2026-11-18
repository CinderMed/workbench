import { FhirDefinitions, buildIndex } from "@cindermed/fhir-defs";
import type { Instance, MappingRow, ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import { choicePathResults, choiceProblem } from "./choice-paths.js";

const SD = "http://hl7.org/fhir/StructureDefinition/";
const sd = (name: string, kind: string, elements: Record<string, Record<string, unknown>>) => ({
  resourceType: "StructureDefinition",
  id: name,
  url: `${SD}${name}`,
  name,
  type: name,
  kind,
  abstract: false,
  derivation: "specialization",
  snapshot: {
    element: Object.entries(elements).map(([path, f]) => ({
      id: path,
      path,
      min: 0,
      max: "1",
      ...f,
    })),
  },
});
const typed = (...codes: string[]) => ({ type: codes.map((code) => ({ code })) });

/** Element names chosen to hit the generator's fixed choice list (ADR-0011) both ways. */
const defs = (() => {
  const index = buildIndex("4.0.1", [
    {
      id: "hl7.fhir.r4.core",
      version: "4.0.1",
      fhirVersions: ["4.0.1"],
      resources: [
        ...["decimal", "positiveInt", "string"].map((p) => sd(p, "primitive-type", { [p]: {} })),
        sd("Quantity", "complex-type", { Quantity: {}, "Quantity.value": typed("decimal") }),
        sd("Immunization", "resource", {
          Immunization: {},
          "Immunization.doseQuantity": typed("Quantity"),
          "Immunization.value[x]": typed("Quantity", "string"),
          "Immunization.protocolApplied": { max: "*", ...typed("BackboneElement") },
          "Immunization.protocolApplied.doseNumber[x]": typed("positiveInt", "string"),
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

describe("choiceProblem", () => {
  it.each([
    ["valueQuantity", undefined],
    ["valueString", undefined],
    [
      "valueQuantity.value",
      "valueQuantity is a choice element: a path through it (valueQuantity.value) cannot be written yet (#156)",
    ],
    [
      "doseQuantity",
      'the generator would write doseQuantity as "dose", but the element is "doseQuantity": it cannot be written yet (#156)',
    ],
    [
      "protocolApplied.doseNumberPositiveInt",
      'the generator would write doseNumberPositiveInt as "doseNumberPositiveInt", but the element is "doseNumber" (a choice): it cannot be written yet (#156)',
    ],
    ["nothing", undefined],
  ])("%s", (path, problem) => {
    expect(choiceProblem(defs, "Immunization", path)).toBe(problem);
  });
});

describe("choicePathResults", () => {
  it("reports rows and fixed values with the generator's code", () => {
    const instance: Instance = {
      id: "ins",
      resourceType: "Immunization",
      index: 0,
      sourceId: "src",
      multiplicity: { kind: "perRow" },
      fixedValues: [{ path: "doseQuantity", value: { type: "string", value: "x" } }],
    };
    const row = (id: string, path: string, instanceId = "ins"): MappingRow => ({
      id,
      code: `R-${id}`,
      instanceId,
      columnId: "c",
      path,
      transform: { kind: "copy" },
    });
    const project: ProjectFile = {
      formatVersion: "1.3.0",
      project: { id: "p", name: "p", fhirVersion: "4.0.1", canonicalBase: "http://example.org" },
      sources: [{ id: "src", name: "T", columns: [{ id: "c", name: "c", dataType: "decimal" }] }],
      instances: [instance],
      mappings: [
        row("1", "valueQuantity.value"),
        row("2", "valueString"),
        row("3", "x", "missing"),
      ],
      valueMaps: [],
    };
    expect(
      choicePathResults(project, defs).map((r) => [r.code, r.objectKind, r.id, r.field]),
    ).toEqual([
      ["PATH_UNSUPPORTED", "instance", "ins", "fixedValues.0.path"],
      ["PATH_UNSUPPORTED", "mapping", "1", "path"],
    ]);
  });
});
