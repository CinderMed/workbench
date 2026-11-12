// Golden case fixtures/fml-examples/mimic-iv-demo (#105): a long table (one row per lab event,
// MIMIC-IV demo slice, ODbL) with three related tables. Every artifact in the folder is generator
// output, or the HL7 engine's compilation of it (+ status draft): the generator must reproduce
// them byte for byte. The Bundles and the comparison with MIMIC-IV on FHIR are checked by the
// golden suite and tooling/mimic-on-fhir.test.ts.
import { isProjectFile, type ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import admissionClass from "../../../fixtures/fml-examples/mimic-iv-demo/ConceptMap-admissionClass.json?raw";
import gender from "../../../fixtures/fml-examples/mimic-iv-demo/ConceptMap-gender.json?raw";
import labItems from "../../../fixtures/fml-examples/mimic-iv-demo/ConceptMap-labItems.json?raw";
import labUnits from "../../../fixtures/fml-examples/mimic-iv-demo/ConceptMap-labUnits.json?raw";
import admissionsMap from "../../../fixtures/fml-examples/mimic-iv-demo/Admissions.map?raw";
import labeventsMap from "../../../fixtures/fml-examples/mimic-iv-demo/Labevents.map?raw";
import patientsMap from "../../../fixtures/fml-examples/mimic-iv-demo/Patients.map?raw";
import admissionsModel from "../../../fixtures/fml-examples/mimic-iv-demo/StructureDefinition-AdmissionsRow.json?raw";
import labeventsModel from "../../../fixtures/fml-examples/mimic-iv-demo/StructureDefinition-LabeventsRow.json?raw";
import patientsModel from "../../../fixtures/fml-examples/mimic-iv-demo/StructureDefinition-PatientsRow.json?raw";
import admissionsJson from "../../../fixtures/fml-examples/mimic-iv-demo/StructureMap-Admissions.json" with { type: "json" };
import labeventsJson from "../../../fixtures/fml-examples/mimic-iv-demo/StructureMap-Labevents.json" with { type: "json" };
import patientsJson from "../../../fixtures/fml-examples/mimic-iv-demo/StructureMap-Patients.json" with { type: "json" };
import admissionsSpec from "../../../fixtures/fml-examples/mimic-iv-demo/normalization-Admissions.json?raw";
import labeventsSpec from "../../../fixtures/fml-examples/mimic-iv-demo/normalization-Labevents.json?raw";
import patientsSpec from "../../../fixtures/fml-examples/mimic-iv-demo/normalization-Patients.json?raw";
import mimicProject from "../../../fixtures/fml-examples/mimic-iv-demo/project.json" with { type: "json" };
import { printMap, printMapWithLines } from "./fml-print.js";
import { conceptMaps } from "./generator/concept-map.js";
import { generateMap } from "./generator/generate-map.js";
import { logicalModel } from "./generator/logical-model.js";
import { normalizationSpec } from "./generator/normalization-spec.js";
import { planTable } from "./generator/table-plan.js";
import { checkGrammar } from "./grammar.js";
import { toStructureMap } from "./structure-map.js";

function project(document: unknown): ProjectFile {
  if (!isProjectFile(document)) throw new Error("fixture is not a valid project");
  return document;
}
const file = project(mimicProject);
const serialize = (value: unknown): string => JSON.stringify(value, null, 2);

describe.each([
  ["Patients", "src_patients", patientsMap, patientsJson, patientsModel, patientsSpec],
  ["Admissions", "src_admissions", admissionsMap, admissionsJson, admissionsModel, admissionsSpec],
  ["Labevents", "src_labevents", labeventsMap, labeventsJson, labeventsModel, labeventsSpec],
] as const)("long-format golden case, table %s", (_name, sourceId, map, json, model, spec) => {
  const planned = planTable(file, sourceId);
  if (!planned.ok) throw new Error(JSON.stringify(planned.results));
  const generated = generateMap(file, planned.value);
  if (!generated.ok) throw new Error(JSON.stringify(generated.results));

  it("prints the committed map byte for byte and passes the grammar check", () => {
    expect(printMap(generated.value)).toBe(map);
    expect(
      checkGrammar(printMapWithLines(generated.value), {
        fallback: { objectKind: "source", id: sourceId },
      }),
    ).toEqual([]);
  });

  it("builds the StructureMap the HL7 engine compiled (+ status draft)", () => {
    expect(toStructureMap(generated.value, { fhirRelease: "R4" })).toEqual(json);
  });

  it("generates the committed logical model and normalization specification", () => {
    expect(serialize(logicalModel(file, planned.value, { version: "0.1.0" }))).toBe(model);
    expect(
      serialize(
        normalizationSpec(file, planned.value, { schemaRef: "../normalization.schema.json" }),
      ),
    ).toBe(spec);
  });
});

describe("long-format golden case, ConceptMaps", () => {
  it("generates the committed ConceptMaps byte for byte", () => {
    expect(conceptMaps(file, { fhirRelease: "R4", version: "0.1.0" }).map(serialize)).toEqual([
      gender,
      admissionClass,
      labItems,
      labUnits,
    ]);
  });
});
