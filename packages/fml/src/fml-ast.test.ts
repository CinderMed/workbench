import { describe, expect, it } from "vitest";
import { FmlNameError, RESERVED_WORDS, groupName, ident, ruleName } from "./fml-ast.js";

describe("name constructors", () => {
  it("accept the names used by the verified maps", () => {
    expect(groupName("HospitalStay")).toBe("HospitalStay");
    expect(groupName("Encounter0")).toBe("Encounter0");
    expect(ident("id_Encounter0")).toBe("id_Encounter0");
    expect(ident("_private")).toBe("_private");
    expect(ruleName("R-006-1")).toBe("R-006-1");
    expect(ruleName("Encounter0-id")).toBe("Encounter0-id");
    expect(ruleName("slice.nrs-code")).toBe("slice.nrs-code");
  });

  it("accept only FHIR ids as rule names (StructureMap.group.rule.name, #120)", () => {
    expect(ruleName("x".repeat(64))).toHaveLength(64);
    for (const bad of ["R-002-S_", "x".repeat(65), "", "a b"]) {
      expect(() => ruleName(bad)).toThrow(FmlNameError);
    }
  });

  it("reject group names with underscores, leading digits or other characters", () => {
    for (const bad of [
      "Hospital_Stay",
      "0Encounter",
      "",
      "Encounter-0",
      "Hospital Stay",
      "`Fall`",
    ]) {
      expect(() => groupName(bad)).toThrow(FmlNameError);
    }
  });

  it("reject identifiers outside [A-Za-z_][A-Za-z0-9_]*", () => {
    for (const bad of ["2nd_visit", "Pain level", "a-b", "", "è", "`log`"]) {
      expect(() => ident(bad)).toThrow(/Identifier is not valid in FML/);
    }
  });

  it("reject the four words the official grammar does not accept", () => {
    expect([...RESERVED_WORDS].sort()).toEqual(["default", "log", "share", "then"]);
    for (const word of RESERVED_WORDS) {
      expect(() => ident(word)).toThrow(/reserved word/);
      expect(() => groupName(word)).toThrow(/reserved word/);
    }
  });

  it("accept the reserved-looking words that the grammar and the HL7 parser accept", () => {
    for (const word of [
      "source",
      "target",
      "group",
      "first",
      "last",
      "check",
      "where",
      "map",
      "uses",
      "alias",
      "prefix",
      "extends",
    ]) {
      expect(ident(word)).toBe(word);
    }
  });

  it("reject rule names that cannot be printed between double quotes", () => {
    for (const bad of ["", 'R"1', "R 1", "R/1", "R·1"]) {
      expect(() => ruleName(bad)).toThrow(FmlNameError);
    }
  });

  it("name the error class", () => {
    expect(new FmlNameError("x").name).toBe("FmlNameError");
  });
});
