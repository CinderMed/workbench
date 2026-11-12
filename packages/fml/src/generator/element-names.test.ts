import { describe, expect, it } from "vitest";
import { FmlNameError } from "../fml-ast.js";
import {
  MAX_ELEMENT_NAME_LENGTH,
  RESERVED_ELEMENT_NAMES,
  assignElementName,
  baseElementName,
} from "./element-names.js";

describe("element names", () => {
  it.each([
    ["log", "log_"],
    ["share", "share_"],
    ["default", "default_"],
    ["then", "then_"],
    ["Pain level (0-10)", "Pain_level__0_10_"],
    ["2nd visit", "c2nd_visit"],
    ["_private", "cc_private"],
    // #134: the HL7 FHIRPath parser rejects a second character "_" (tooling/hl7-probes).
    ["a b", "ca_b"],
    ["a-b", "ca_b"],
    ["x ", "cx_"],
    ["A_B", "cA_B"],
    ["😀 mood", "cc__mood"],
    ["ÄÖÜ", "cc___"],
    ["___", "cc___"],
    ["a", "a"],
    ["X", "X"],
    ["a1_b", "a1_b"],
    ["ab_c", "ab_c"],
    ["", "c"],
    ["AdmissionDate", "AdmissionDate"],
    ["source", "source"],
    ["perché", "perch_"],
    ["peso😀", "peso_"],
  ])("%s → %s", (column, element) => {
    expect(baseElementName(column)).toBe(element);
  });

  it("cuts names to 64 characters", () => {
    expect(baseElementName("a".repeat(80))).toHaveLength(MAX_ELEMENT_NAME_LENGTH);
  });

  it("adds a numeric suffix on collisions, in order", () => {
    const taken = new Set<string>();
    expect(assignElementName("a b", taken)).toBe("ca_b");
    expect(assignElementName("a-b", taken)).toBe("ca_b2");
    expect(assignElementName("a.b", taken)).toBe("ca_b3");
    expect([...taken]).toEqual(["ca_b", "ca_b2", "ca_b3"]);
  });

  it("keeps a suffixed long name within 64 characters", () => {
    const taken = new Set<string>();
    const long = "x".repeat(70);
    assignElementName(long, taken);
    const second = assignElementName(long, taken);
    expect(second).toBe(`${"x".repeat(60)}2`);
  });

  it("avoids names already taken by id fields", () => {
    expect(assignElementName("id_Patient0", new Set(["id_Patient0"]))).toBe("id_Patient02");
  });

  it("always returns a valid FML identifier", () => {
    expect(() => assignElementName("", new Set())).not.toThrow(FmlNameError);
    expect(assignElementName("", new Set())).toBe("c");
  });

  it("starts every name with a letter followed, if there is more, by a letter or a digit", () => {
    const columns = [
      "a b",
      "_",
      "__x",
      "1",
      "1_",
      "é",
      "é_é",
      "a",
      "😀",
      "x".repeat(70),
      "_".repeat(70),
    ];
    for (const column of columns)
      expect(baseElementName(column), column).toMatch(/^[A-Za-z](?:[A-Za-z0-9][A-Za-z0-9_]*)?$/);
  });

  it("reserves id, extension and resourceType for the row itself", () => {
    expect([...RESERVED_ELEMENT_NAMES].sort()).toEqual(["extension", "id", "resourceType"]);
  });
});
