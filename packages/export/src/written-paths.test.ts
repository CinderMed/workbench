import { describe, expect, it } from "vitest";
import { r4Definitions } from "./test-support/r4-definitions.js";
import { writtenSegments } from "./written-paths.js";

describe("written paths from the R4 definitions (#156, ADR-0023)", () => {
  const defs = r4Definitions();
  const segments = (ref: string, path: string) => {
    const found = writtenSegments(defs, ref, path);
    if ("message" in found) throw new Error(found.message);
    return found.segments;
  };

  it("names a choice element by its base name, with the type the path chooses", () => {
    expect(segments("Observation", "valueString")).toEqual([
      { name: "value", choiceType: "string" },
    ]);
    expect(segments("Observation", "effectiveDateTime")).toEqual([
      { name: "effective", choiceType: "dateTime" },
    ]);
    expect(segments("Condition", "onsetAge")).toEqual([{ name: "onset", choiceType: "Age" }]);
    expect(segments("Observation", "component[nrs].valueInteger")).toEqual([
      { name: "component" },
      { name: "value", choiceType: "integer" },
    ]);
  });

  it("keeps the own name of an element that is not a choice, whatever it looks like", () => {
    // doseQuantity is not a choice in R4 (the old name list wrote it as "dose").
    expect(segments("Immunization", "doseQuantity")).toEqual([{ name: "doseQuantity" }]);
    expect(segments("Immunization", "protocolApplied.doseNumberPositiveInt")).toEqual([
      { name: "protocolApplied" },
      { name: "doseNumber", choiceType: "positiveInt" },
    ]);
    expect(segments("Patient", "birthDate")).toEqual([{ name: "birthDate" }]);
  });

  it("says why a path does not resolve", () => {
    expect(writtenSegments(defs, "Patient", "notAnElement")).toMatchObject({
      message: expect.stringContaining("notAnElement") as unknown,
    });
  });
});
