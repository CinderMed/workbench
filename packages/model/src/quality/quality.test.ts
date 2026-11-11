import { describe, expect, it } from "vitest";
import metastra from "../../../../fixtures/fml-examples/metastra/project.json" with { type: "json" };
import motu from "../../../../fixtures/fml-examples/motu/project.json" with { type: "json" };
import booleanCase from "../../../../fixtures/fml-examples/boolean-value-map/project.json" with { type: "json" };
import type { Column, ProjectFile } from "../generated/project.js";
import { at } from "../integrity/__tests__/helpers.js";
import { cleanProject } from "../integrity/__tests__/builder.js";
import { validateProject } from "../project-file/index.js";
import { QualityCode, checkQuality } from "./index.js";

function withColumn(column: Column): ProjectFile {
  const project = cleanProject();
  at(project.sources, 0).columns.push(column);
  return project;
}

describe("quality: categorical and multiple-choice columns without allowed values", () => {
  it("accepts the clean project and the verified examples", () => {
    expect(checkQuality(cleanProject())).toEqual([]);
    for (const example of [metastra, motu, booleanCase]) {
      expect(checkQuality(example as ProjectFile)).toEqual([]);
    }
  });

  it("warns that the values will not be checked during conversion", () => {
    const project = withColumn({ id: "col_smoker", name: "smoker", dataType: "categorical" });
    expect(checkQuality(project)).toEqual([
      {
        severity: "warning",
        code: QualityCode.ALLOWED_VALUES_MISSING,
        objectKind: "column",
        id: "col_smoker",
        field: "allowedValues",
        message:
          "column 'smoker' is categorical without allowed values: values will not be checked during conversion",
      },
    ]);
  });

  it("warns for multiple-choice columns too, and not for other types", () => {
    const project = withColumn({ id: "col_sites2", name: "sites2", dataType: "multipleChoice" });
    at(project.sources, 0).columns.push({ id: "col_note", name: "note", dataType: "string" });
    expect(checkQuality(project).map((r) => r.id)).toEqual(["col_sites2"]);
  });

  it("leaves a column used by a value map to integrity rule 6", () => {
    const project = cleanProject();
    delete at(at(project.sources, 0).columns, 1).allowedValues;
    expect(checkQuality(project)).toEqual([]);
  });

  it("is part of project validation, after the integrity errors, and does not block", () => {
    const project = withColumn({ id: "col_smoker", name: "smoker", dataType: "categorical" });
    delete at(at(project.sources, 0).columns, 1).allowedValues;
    expect(validateProject(project).map((r) => [r.severity, r.code])).toEqual([
      ["error", "VALUE_MAP_COLUMN_WITHOUT_ALLOWED_VALUES"],
      ["warning", QualityCode.ALLOWED_VALUES_MISSING],
    ]);
  });
});
