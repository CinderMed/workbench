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
    ["_private", "c_private"],
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
    expect(assignElementName("a b", taken)).toBe("a_b");
    expect(assignElementName("a-b", taken)).toBe("a_b2");
    expect(assignElementName("a.b", taken)).toBe("a_b3");
    expect([...taken]).toEqual(["a_b", "a_b2", "a_b3"]);
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

  it("reserves id, extension and resourceType for the row itself", () => {
    expect([...RESERVED_ELEMENT_NAMES].sort()).toEqual(["extension", "id", "resourceType"]);
  });
});
