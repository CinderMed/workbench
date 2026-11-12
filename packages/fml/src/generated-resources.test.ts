// Safeguard (#120): no generated resource may hold an empty string. FHIR does not allow them, and
// the Python prototype once wrote "description": "" into every ConceptMap without a description.
// The test walks every artifact the generator produces for the verified examples.
import { isProjectFile, type ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import visitProject from "../../../fixtures/fml-examples/boolean-value-map/project.json" with { type: "json" };
import mimicProject from "../../../fixtures/fml-examples/mimic-iv-demo/project.json" with { type: "json" };
import metastraProject from "../../../fixtures/fml-examples/metastra/project.json" with { type: "json" };
import motuProject from "../../../fixtures/fml-examples/motu/project.json" with { type: "json" };
import { conceptMaps } from "./generator/concept-map.js";
import { generateMap } from "./generator/generate-map.js";
import { logicalModel } from "./generator/logical-model.js";
import { normalizationSpec } from "./generator/normalization-spec.js";
import { planTable } from "./generator/table-plan.js";
import { toStructureMap } from "./structure-map.js";
import { emptyStrings } from "./test-support/empty-strings.js";

function resources(document: unknown): [string, unknown][] {
  if (!isProjectFile(document)) throw new Error("fixture is not a valid project");
  const project: ProjectFile = document;
  const out: [string, unknown][] = [];
  for (const release of ["R4", "R5"] as const) {
    for (const map of conceptMaps(project, { fhirRelease: release }))
      out.push([`ConceptMap ${map.id} ${release}`, map]);
  }
  for (const source of project.sources) {
    const planned = planTable(project, source.id);
    if (!planned.ok) throw new Error(JSON.stringify(planned.results));
    out.push([`logical model ${source.name}`, logicalModel(project, planned.value)]);
    out.push([`normalization ${source.name}`, normalizationSpec(project, planned.value)]);
    const map = generateMap(project, planned.value);
    if (!map.ok) throw new Error(JSON.stringify(map.results));
    for (const release of ["R4", "R5"] as const) {
      out.push([
        `StructureMap ${source.name} ${release}`,
        toStructureMap(map.value, { fhirRelease: release }),
      ]);
    }
  }
  return out;
}

describe.each([
  ["Metastra", metastraProject],
  ["MOTU", motuProject],
  ["boolean-value-map", visitProject],
  ["MIMIC-IV demo", mimicProject],
])("generated resources of %s", (_name, document) => {
  it.each(resources(document))("%s has no empty string", (_label, resource) => {
    expect(emptyStrings(resource)).toEqual([]);
  });
});

describe("emptyStrings", () => {
  it("finds empty strings at any depth", () => {
    expect(emptyStrings({ a: "", b: [{ c: "x" }, { d: "" }], e: 0, f: null })).toEqual([
      "$.a",
      "$.b[1].d",
    ]);
  });
});
