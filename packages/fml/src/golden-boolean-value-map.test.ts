// Golden case fixtures/fml-examples/boolean-value-map: an Italian yes/no column (Sì/No) is
// categorical, with a value map to boolean on Observation.valueBoolean. The map was printed from
// the syntax tree below and compiled and run by the HL7 engine (tests/run-all.sh).
import { isProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import compiled from "../../../fixtures/fml-examples/boolean-value-map/StructureMap-Visit.json" with { type: "json" };
import expectedModel from "../../../fixtures/fml-examples/boolean-value-map/StructureDefinition-VisitRow.json?raw";
import visitMap from "../../../fixtures/fml-examples/boolean-value-map/Visit.map?raw";
import expectedNormalization from "../../../fixtures/fml-examples/boolean-value-map/normalization-Visit.json?raw";
import projectDocument from "../../../fixtures/fml-examples/boolean-value-map/project.json" with { type: "json" };
import { printMap, printMapWithLines } from "./fml-print.js";
import { logicalModel } from "./generator/logical-model.js";
import { normalizationSpec } from "./generator/normalization-spec.js";
import { planTable } from "./generator/table-plan.js";
import { checkGrammar } from "./grammar.js";
import { toStructureMap } from "./structure-map.js";
import { booleanValueMap } from "./test-support/boolean-value-map.js";

describe("golden case boolean-value-map", () => {
  it("prints the syntax tree byte-identical to the committed map", () => {
    expect(printMap(booleanValueMap)).toBe(visitMap);
  });

  it("builds the StructureMap the HL7 engine compiled from that text, status aside", () => {
    const { status, ...built } = toStructureMap(booleanValueMap, { fhirRelease: "R4" });
    expect(status).toBe("draft");
    expect(built).toEqual(compiled);
  });

  it("passes the grammar check", () => {
    expect(
      checkGrammar(printMapWithLines(booleanValueMap), {
        fallback: { objectKind: "source", id: "src_visit" },
      }),
    ).toEqual([]);
  });

  it("generates the committed logical model and normalization specification", () => {
    if (!isProjectFile(projectDocument)) throw new Error("fixture is not a valid project");
    const planned = planTable(projectDocument, "src_visit");
    if (!planned.ok) throw new Error(JSON.stringify(planned.results));
    expect(JSON.stringify(logicalModel(projectDocument, planned.value), null, 2)).toBe(
      expectedModel,
    );
    const spec = normalizationSpec(projectDocument, planned.value, {
      schemaRef: "../normalization.schema.json",
    });
    expect(JSON.stringify(spec, null, 2)).toBe(expectedNormalization);
    expect(spec.onInvalidValue).toBe("fail");
  });
});
