import type { Column } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import { normalizationAllowedValues } from "./normalization-spec.js";

const column = (fields: Partial<Column>): Column => ({
  id: "col",
  name: "col",
  dataType: "categorical",
  ...fields,
});

describe("normalizationAllowedValues", () => {
  it("keeps the project order and the case, in canonical text (NFC, trim)", () => {
    // "Sì" is "Sì" decomposed: NFC turns it into the same value as "Sì".
    const values = [{ code: " Sì " }, { code: "Sì" }, { code: "sì" }, { code: "No" }];
    expect(normalizationAllowedValues(column({ allowedValues: values }))).toEqual([
      "Sì",
      "sì",
      "No",
    ]);
  });

  it("leaves out values that are also missing values", () => {
    const allowedValues = [{ code: "1" }, { code: "0" }, { code: "-1" }];
    expect(normalizationAllowedValues(column({ allowedValues, missingValues: [" -1"] }))).toEqual([
      "1",
      "0",
    ]);
  });

  it("checks multiple-choice columns too", () => {
    const allowedValues = [{ code: "1" }, { code: "2" }];
    expect(
      normalizationAllowedValues(column({ dataType: "multipleChoice", allowedValues })),
    ).toEqual(["1", "2"]);
  });

  it("gives undefined without a list or for other types", () => {
    expect(normalizationAllowedValues(column({}))).toBeUndefined();
    expect(
      normalizationAllowedValues(column({ dataType: "integer", allowedValues: [{ code: "1" }] })),
    ).toBeUndefined();
  });
});
