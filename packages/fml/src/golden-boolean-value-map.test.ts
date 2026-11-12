// Golden case fixtures/fml-examples/boolean-value-map: an Italian yes/no column (Sì/No) is
// categorical, with a value map to boolean on Observation.valueBoolean. The map itself is checked
// with the other generated maps (golden-generated-maps.test.ts); this test checks the table
// artifacts the generator writes for it.
import { isProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import expectedModel from "../../../fixtures/fml-examples/boolean-value-map/StructureDefinition-VisitRow.json?raw";
import expectedNormalization from "../../../fixtures/fml-examples/boolean-value-map/normalization-Visit.json?raw";
import projectDocument from "../../../fixtures/fml-examples/boolean-value-map/project.json" with { type: "json" };
import { logicalModel } from "./generator/logical-model.js";
import { normalizationSpec } from "./generator/normalization-spec.js";
import { planTable } from "./generator/table-plan.js";

describe("golden case boolean-value-map", () => {
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
