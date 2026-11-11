import { describe, expect, it } from "vitest";
import booleanCase from "../../../../fixtures/fml-examples/boolean-value-map/project.json" with { type: "json" };
import type { Column, ProjectFile } from "../generated/project.js";
import { check, only } from "./__tests__/helpers.js";
import { IntegrityCode, checkIntegrity } from "./index.js";

function column(p: ProjectFile, id: string): Column {
  const found = p.sources.flatMap((source) => source.columns).find((c) => c.id === id);
  if (found === undefined) throw new Error(`no column ${id}`);
  return found;
}

const mismatches = (mutate: (p: ProjectFile) => void) =>
  only(IntegrityCode.ALLOWED_VALUE_TYPE_MISMATCH, check(mutate));

describe("rule 9: allowed values fit the column type", () => {
  it("accepts the clean project", () => {
    expect(mismatches(() => undefined)).toEqual([]);
  });

  it("rejects a boolean value outside the canonical forms and suggests a value map", () => {
    const results = mismatches((p) => {
      const sex = column(p, "col_sex");
      sex.dataType = "boolean";
      sex.allowedValues = [{ code: "Sì" }, { code: "No" }, { code: "y" }];
    });
    expect(results).toEqual([
      expect.objectContaining({
        severity: "error",
        objectKind: "column",
        id: "col_sex",
        field: "allowedValues.0.code",
        message: expect.stringContaining("categorical and map its values to boolean") as unknown,
      }),
    ]);
  });

  it("checks decimals with the column's decimal separator", () => {
    const comma = mismatches((p) => {
      const hb = column(p, "col_hb");
      hb.decimalSeparator = ",";
      hb.allowedValues = [{ code: "11,20" }, { code: "abc" }, { code: "1.234" }, { code: "1.5" }];
    });
    expect(comma.map((r) => r.field)).toEqual([
      "allowedValues.1.code",
      "allowedValues.2.code",
      "allowedValues.3.code",
    ]);
    expect(comma[0]?.message).toContain("separator ','");

    const point = mismatches((p) => {
      column(p, "col_hb").allowedValues = [{ code: "11,20" }, { code: "11.20" }];
    });
    expect(point.map((r) => r.field)).toEqual(["allowedValues.0.code"]);
  });

  it("rejects non-integer values in an integer column", () => {
    const results = mismatches((p) => {
      const hb = column(p, "col_hb");
      hb.dataType = "integer";
      hb.allowedValues = [{ code: "1" }, { code: "1.5" }, { code: "+2" }];
    });
    expect(results.map((r) => [r.field, r.message])).toEqual([
      ["allowedValues.1.code", expect.stringContaining("is not an integer")],
    ]);
  });

  it("checks dates and date-times against dateFormat, with a calendar check", () => {
    const dates = mismatches((p) => {
      const adm = column(p, "col_adm");
      adm.dateFormat = "dd/MM/yyyy";
      adm.allowedValues = [{ code: "17/09/2023" }, { code: "31/02/2023" }, { code: "2023-09-17" }];
    });
    expect(dates.map((r) => r.field)).toEqual(["allowedValues.1.code", "allowedValues.2.code"]);
    expect(dates[0]?.message).toContain("format 'dd/MM/yyyy'");

    const dateTimes = mismatches((p) => {
      const adm = column(p, "col_adm");
      adm.dataType = "dateTime";
      adm.allowedValues = [{ code: "2023-09-17T10:00:00" }, { code: "2023-09-17T25:00:00" }];
    });
    expect(dateTimes.map((r) => r.field)).toEqual(["allowedValues.1.code"]);
  });

  it("ignores values listed in missingValues and empty values", () => {
    expect(
      mismatches((p) => {
        const hb = column(p, "col_hb");
        hb.missingValues = ["NA", " ND "];
        hb.allowedValues = [{ code: "NA" }, { code: "ND" }, { code: "  " }, { code: " 11.2 " }];
      }),
    ).toEqual([]);
  });

  it("does not check string, categorical and multiple-choice columns", () => {
    expect(
      mismatches((p) => {
        column(p, "col_pid").allowedValues = [{ code: "anything" }];
        column(p, "col_sex").allowedValues = [{ code: "Sì" }];
        column(p, "col_sites").allowedValues = [{ code: "x,y" }];
      }),
    ).toEqual([]);
  });

  it("accepts the Sì/No golden case as categorical, and rejects it typed as boolean", () => {
    const project = JSON.parse(JSON.stringify(booleanCase)) as ProjectFile;
    expect(checkIntegrity(project)).toEqual([]);
    column(project, "col_smoker").dataType = "boolean";
    expect(only(IntegrityCode.ALLOWED_VALUE_TYPE_MISMATCH, checkIntegrity(project))).toEqual([
      // "No" is a canonical boolean (no, case-insensitive); "Sì" is not.
      expect.objectContaining({ id: "col_smoker", field: "allowedValues.0.code" }),
    ]);
  });
});

describe("rule 9: an allowed-values list is not empty once missing values are removed", () => {
  const empty = (mutate: (p: ProjectFile) => void) =>
    only(IntegrityCode.ALLOWED_VALUES_EMPTY, check(mutate));

  it("accepts the clean project", () => {
    expect(empty(() => undefined)).toEqual([]);
  });

  it("reports an empty list", () => {
    expect(
      empty((p) => {
        column(p, "col_sex").allowedValues = [];
      }),
    ).toEqual([
      {
        severity: "error",
        code: IntegrityCode.ALLOWED_VALUES_EMPTY,
        objectKind: "column",
        id: "col_sex",
        field: "allowedValues",
        message:
          "column 'sex' has no allowed values left once missing values are removed: the conversion would reject every value",
      },
    ]);
  });

  it("reports a list made only of missing values, multiple choice included", () => {
    const results = empty((p) => {
      const sites = column(p, "col_sites");
      sites.allowedValues = [{ code: " 99" }, { code: "" }];
      sites.missingValues = ["99"];
    });
    expect(results.map((r) => r.id)).toEqual(["col_sites"]);
  });

  it("does not check other types, or columns without a list", () => {
    expect(
      empty((p) => {
        const hb = column(p, "col_hb");
        hb.allowedValues = [{ code: "NA" }];
        hb.missingValues = ["NA"];
        delete column(p, "col_sex").allowedValues;
      }),
    ).toEqual([]);
  });
});
