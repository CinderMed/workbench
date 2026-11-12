// Golden tests of the generator on the verified maps (fixtures/fml-examples).
//
// RELAXED COMPARISON until #97 (chore/fixtures-generated-maps) regenerates the fixture maps with
// the generator: the hand-written maps hold comments and blank lines the generator does not
// reproduce. Only these differences are ignored:
// - in the FML text, `//` comment lines and blank lines;
// - in the StructureMap JSON, `text.div` (the narrative embeds the FML text).
// Every other byte must match. #97 removes this relaxation and compares the files whole.
import { isProjectFile, type ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import fallJson from "../../../fixtures/fml-examples/motu/StructureMap-Fall.json" with { type: "json" };
import stayJson from "../../../fixtures/fml-examples/motu/StructureMap-HospitalStay.json" with { type: "json" };
import fallMap from "../../../fixtures/fml-examples/motu/Fall.map?raw";
import stayMap from "../../../fixtures/fml-examples/motu/HospitalStay.map?raw";
import visitMap from "../../../fixtures/fml-examples/boolean-value-map/Visit.map?raw";
import visitProject from "../../../fixtures/fml-examples/boolean-value-map/project.json" with { type: "json" };
import firstOverviewMap from "../../../fixtures/fml-examples/metastra/FirstOverview.map?raw";
import metastraProject from "../../../fixtures/fml-examples/metastra/project.json" with { type: "json" };
import patientMap from "../../../fixtures/fml-examples/motu/MotuPatient.map?raw";
import motuProject from "../../../fixtures/fml-examples/motu/project.json" with { type: "json" };
import { printMap, printMapWithLines } from "./fml-print.js";
import { generateMap } from "./generator/generate-map.js";
import { planTable } from "./generator/table-plan.js";
import { checkGrammar } from "./grammar.js";
import { toStructureMap } from "./structure-map.js";

/** Removes `//` comment lines and blank lines (the relaxation tracked by #97). */
const withoutComments = (text: string): string =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("//"))
    .join("\n");

/** StructureMap JSON without `text.div` (the relaxation tracked by #97). */
function withoutNarrative(json: unknown): unknown {
  const rest = { ...(json as Record<string, unknown>) };
  delete rest["text"];
  return rest;
}

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

const motu = project(motuProject);
const cases = [
  ["MOTU HospitalStay", motu, "src_stay", stayMap, stayJson],
  ["MOTU Fall", motu, "src_fall", fallMap, fallJson],
] as const;

describe.each(cases)("generator golden case %s", (_name, file, sourceId, map, json) => {
  const generated = generate(file, sourceId);

  it("prints the verified map, comments and blank lines aside (#97)", () => {
    expect(withoutComments(printMap(generated))).toBe(withoutComments(map));
  });

  it("builds the StructureMap the HL7 engine compiled, narrative aside (#97)", () => {
    expect(withoutNarrative(toStructureMap(generated, { fhirRelease: "R4" }))).toEqual(
      withoutNarrative(json),
    );
  });

  it("passes the grammar check", () => {
    expect(
      checkGrammar(printMapWithLines(generated), {
        fallback: { objectKind: "source", id: sourceId },
      }),
    ).toEqual([]);
  });
});

// The maps below differ from the verified ones by design (ADR-0011) until #97 regenerates them.
// Each difference is listed: the verified text with these substitutions applied must equal the
// generated text, comments and blank lines aside. The behaviour is checked by the golden suite
// (tooling/golden/run-examples.sh, second pass): the generated maps give the committed Bundles.

/** A single-row `identifier` block becomes an inline parent (Option B, ADR-0011). */
const inlineIdentifier = (column: string): [string, string] => [
  `  src where ($this.${column}.exists()) -> res.identifier as rep then {\n    src.${column} as v -> rep.value = v "R-001";\n  } "Patient0-identifier";`,
  `  src.${column} as v -> res.identifier as p, p.value = v "R-001";`,
];

const known = [
  ["MOTU MotuPatient", motuProject, "src_patient", patientMap, [inlineIdentifier("AnonymousID")]],
  [
    "Metastra FirstOverview",
    metastraProject,
    "src_firstoverview",
    firstOverviewMap,
    [
      inlineIdentifier("patient_id"),
      // The references of Observation[1] are rows R-015 and R-016 since #99.
      ['"subject-auto";', '"R-015";'],
      ['"encounter-auto";', '"R-016";'],
      ['"encounter-auto-guard";', '"R-016-guard";'],
    ],
  ],
  [
    "boolean-value-map Visit",
    visitProject,
    "src_visit",
    visitMap,
    [inlineIdentifier("patient_id")],
  ],
] as const;

describe.each(known)(
  "generator case %s (known differences until #97)",
  (_name, document, sourceId, map, differences) => {
    const generated = generate(project(document), sourceId);

    it("prints the verified map with only the listed differences, comments aside", () => {
      let expected = withoutComments(map);
      for (const [from, to] of differences) {
        const before = withoutComments(from);
        expect(expected).toContain(before);
        expected = expected.replace(before, withoutComments(to));
      }
      expect(withoutComments(printMap(generated))).toBe(expected);
    });

    it("passes the grammar check", () => {
      expect(
        checkGrammar(printMapWithLines(generated), {
          fallback: { objectKind: "source", id: sourceId },
        }),
      ).toEqual([]);
    });
  },
);
