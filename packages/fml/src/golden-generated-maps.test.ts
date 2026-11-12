// Golden tests of the generator on the verified examples (fixtures/fml-examples). Since #97 the
// fixture maps are produced only by the generator: the printed map must equal the committed .map
// byte for byte, and the StructureMap JSON must equal the JSON the HL7 engine compiled from it
// (plus `status: draft`, ADR-0007), narrative included. The golden suite then checks that these
// maps give the committed Bundles (tooling/golden/run-examples.sh).
import { isProjectFile, type ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import namesJson from "../../../fixtures/fml-examples/element-names/StructureMap-Visit.json" with { type: "json" };
import namesMap from "../../../fixtures/fml-examples/element-names/Visit.map?raw";
import namesProject from "../../../fixtures/fml-examples/element-names/project.json" with { type: "json" };
import visitJson from "../../../fixtures/fml-examples/boolean-value-map/StructureMap-Visit.json" with { type: "json" };
import visitMap from "../../../fixtures/fml-examples/boolean-value-map/Visit.map?raw";
import visitProject from "../../../fixtures/fml-examples/boolean-value-map/project.json" with { type: "json" };
import firstOverviewMap from "../../../fixtures/fml-examples/metastra/FirstOverview.map?raw";
import firstOverviewJson from "../../../fixtures/fml-examples/metastra/StructureMap-FirstOverview.json" with { type: "json" };
import metastraProject from "../../../fixtures/fml-examples/metastra/project.json" with { type: "json" };
import fallMap from "../../../fixtures/fml-examples/motu/Fall.map?raw";
import stayMap from "../../../fixtures/fml-examples/motu/HospitalStay.map?raw";
import patientMap from "../../../fixtures/fml-examples/motu/MotuPatient.map?raw";
import fallJson from "../../../fixtures/fml-examples/motu/StructureMap-Fall.json" with { type: "json" };
import stayJson from "../../../fixtures/fml-examples/motu/StructureMap-HospitalStay.json" with { type: "json" };
import patientJson from "../../../fixtures/fml-examples/motu/StructureMap-MotuPatient.json" with { type: "json" };
import motuProject from "../../../fixtures/fml-examples/motu/project.json" with { type: "json" };
import { printMap, printMapWithLines } from "./fml-print.js";
import { generateMap } from "./generator/generate-map.js";
import { planTable } from "./generator/table-plan.js";
import { checkGrammar } from "./grammar.js";
import { toStructureMap } from "./structure-map.js";

function project(document: unknown): ProjectFile {
  if (!isProjectFile(document)) throw new Error("fixture is not a valid project");
  return document;
}

function generate(file: ProjectFile, sourceId: string) {
  const planned = planTable(file, sourceId);
  if (!planned.ok) throw new Error(JSON.stringify(planned.results));
  const map = generateMap(file, planned.value);
  if (!map.ok) throw new Error(JSON.stringify(map.results));
  return map.value;
}

const cases = [
  [
    "Metastra FirstOverview",
    metastraProject,
    "src_firstoverview",
    firstOverviewMap,
    firstOverviewJson,
  ],
  ["MOTU MotuPatient", motuProject, "src_patient", patientMap, patientJson],
  ["MOTU HospitalStay", motuProject, "src_stay", stayMap, stayJson],
  ["MOTU Fall", motuProject, "src_fall", fallMap, fallJson],
  ["boolean-value-map Visit", visitProject, "src_visit", visitMap, visitJson],
  ["element-names Visit", namesProject, "src_visit", namesMap, namesJson],
] as const;

describe.each(cases)("generator golden case %s", (_name, document, sourceId, map, json) => {
  const generated = generate(project(document), sourceId);

  it("prints the committed map byte for byte", () => {
    expect(printMap(generated)).toBe(map);
  });

  it("builds the StructureMap the HL7 engine compiled from it (+ status draft)", () => {
    expect(toStructureMap(generated, { fhirRelease: "R4" })).toEqual(json);
  });

  it("passes the grammar check", () => {
    expect(
      checkGrammar(printMapWithLines(generated), {
        fallback: { objectKind: "source", id: sourceId },
      }),
    ).toEqual([]);
  });
});
