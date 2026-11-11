import { describe, expect, it } from "vitest";
import { baseValueRuleName, valueRuleNames } from "./rule-names.js";

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

  it("replaces characters outside [A-Za-z0-9_.-] with _", () => {
    expect(baseValueRuleName("R-002", "Sì")).toBe("R-002-S_");
    expect(baseValueRuleName("R-002", "N/A")).toBe("R-002-N_A");
    expect(baseValueRuleName("R-002", "N A")).toBe("R-002-N_A");
    expect(baseValueRuleName("R-002", "1.5")).toBe("R-002-1.5");
    expect(baseValueRuleName("R-002", "😀")).toBe("R-002-_");
  });

  it("adds a numeric suffix when two values get the same name, in entry order", () => {
    expect(valueRuleNames("R-002", ["Sì", "Sí", "No"])).toEqual([
      "R-002-S_",
      "R-002-S_2",
      "R-002-No",
    ]);
    expect(valueRuleNames("R-002", ["N/A", "N A", "N-A"])).toEqual([
      "R-002-N_A",
      "R-002-N_A2",
      "R-002-N-A",
    ]);
    expect(valueRuleNames("R-002", ["Sì", "Sí", "Sï"])).toEqual([
      "R-002-S_",
      "R-002-S_2",
      "R-002-S_3",
    ]);
  });

  it("never reuses a name, even when a value looks like a suffixed name", () => {
    expect(valueRuleNames("R-002", ["Sì", "Sí", "S_2"])).toEqual([
      "R-002-S_",
      "R-002-S_2",
      "R-002-S_22",
    ]);
    expect(valueRuleNames("R-002", ["S_2", "Sì", "Sí"])).toEqual([
      "R-002-S_2",
      "R-002-S_",
      "R-002-S_3",
    ]);
  });
});
