import { describe, expect, it } from "vitest";
import { MAX_RULE_NAME_LENGTH, baseValueRuleName, valueRuleNames } from "./rule-names.js";

describe("value-map rule names", () => {
  it("keeps the names of the verified maps", () => {
    expect(valueRuleNames("R-006", ["0", "1", "2", "3"])).toEqual([
      "R-006-0",
      "R-006-1",
      "R-006-2",
      "R-006-3",
    ]);
    expect(valueRuleNames("R-011", ["1", "-1", "0"])).toEqual(["R-011-1", "R-011--1", "R-011-0"]);
    expect(valueRuleNames("R-002", ["Female", "Male"])).toEqual(["R-002-Female", "R-002-Male"]);
  });

  it("replaces characters outside [A-Za-z0-9.-] with -, as a FHIR id requires", () => {
    expect(baseValueRuleName("R-002", "Sì")).toBe("R-002-S-");
    expect(baseValueRuleName("R-002", "N/A")).toBe("R-002-N-A");
    expect(baseValueRuleName("R-002", "N A")).toBe("R-002-N-A");
    expect(baseValueRuleName("R-002", "under_score")).toBe("R-002-under-score");
    expect(baseValueRuleName("R-002", "1.5")).toBe("R-002-1.5");
    expect(baseValueRuleName("R-002", "😀")).toBe("R-002--");
  });

  it("adds a numeric suffix when two values get the same name, in entry order", () => {
    expect(valueRuleNames("R-002", ["Sì", "Sí", "No"])).toEqual([
      "R-002-S-",
      "R-002-S-2",
      "R-002-No",
    ]);
    // N/A, N A and N-A all give R-002-N-A now.
    expect(valueRuleNames("R-002", ["N/A", "N A", "N-A"])).toEqual([
      "R-002-N-A",
      "R-002-N-A2",
      "R-002-N-A3",
    ]);
  });

  it("never reuses a name, even when a value looks like a suffixed name", () => {
    expect(valueRuleNames("R-002", ["Sì", "Sí", "S-2"])).toEqual([
      "R-002-S-",
      "R-002-S-2",
      "R-002-S-22",
    ]);
    expect(valueRuleNames("R-002", ["S-2", "Sì", "Sí"])).toEqual([
      "R-002-S-2",
      "R-002-S-",
      "R-002-S-3",
    ]);
  });

  it("keeps every name within 64 characters, suffix included", () => {
    const long = "x".repeat(100);
    const [first, second, third] = valueRuleNames("R-002", [long, `${long}y`, `${long}z`]);
    expect(first).toBe(`R-002-${"x".repeat(58)}`);
    expect(second).toBe(`R-002-${"x".repeat(57)}2`);
    expect(third).toBe(`R-002-${"x".repeat(57)}3`);
    for (const name of [first, second, third]) expect(name?.length).toBe(MAX_RULE_NAME_LENGTH);
  });
});
