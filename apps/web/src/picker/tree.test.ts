import { describe, expect, it } from "vitest";
import { patientProject, syntheticDefinitions } from "../validation/synthetic-definitions";
import { cardinality, loadLevels, roleDefinition, treeLines } from "./tree";

const role = () => {
  const found = patientProject().instances[0];
  if (found === undefined) throw new Error("a patient role");
  return found;
};

async function rootLevels() {
  const { defs, fetch } = syntheticDefinitions();
  const loaded = await loadLevels(defs, fetch, "Patient", "", new Map());
  if ("message" in loaded) throw new Error(loaded.message);
  return { defs, fetch, levels: loaded.levels };
}

describe("the picker's tree", () => {
  it("resolves a role to its resource type, or nothing when the type is unknown", () => {
    const { defs } = syntheticDefinitions();
    expect(roleDefinition(defs, role())).toBe("Patient");
    expect(roleDefinition(defs, { ...role(), resourceType: "Nothing" })).toBeUndefined();
    expect(roleDefinition(defs, { ...role(), profile: "http://example.org/not-loaded" })).toBe(
      "Patient",
    );
  });

  it("loads the root with its backbone elements, and datatypes only when opened", async () => {
    const { defs, fetch, levels } = await rootLevels();
    expect(levels.get("")?.map((n) => [n.name, cardinality(n)])).toEqual([
      ["active", "0..1"],
      ["name", "0..*"],
      ["contact", "0..*"],
    ]);
    expect(levels.get("contact")?.map((n) => n.name)).toEqual(["name", "relationship"]);
    expect(levels.has("name")).toBe(false); // HumanName: a datatype, opened on demand.
    const opened = await loadLevels(defs, fetch, "Patient", "name", levels, 0);
    if ("message" in opened) throw new Error(opened.message);
    expect(opened.levels.get("name")?.map((n) => n.path)).toEqual(["name.family", "name.text"]);
  });

  it("shows opened nodes, and a search with the ancestors of what it finds", async () => {
    const { levels } = await rootLevels();
    expect(treeLines(levels, new Set(), "").map((l) => l.node.path)).toEqual([
      "active",
      "name",
      "contact",
    ]);
    expect(treeLines(levels, new Set(["contact"]), "").map((l) => [l.node.path, l.depth])).toEqual([
      ["active", 0],
      ["name", 0],
      ["contact", 0],
      ["contact.name", 1],
      ["contact.relationship", 1],
    ]);
    // "rel" is found inside the backbone, which opens for it; "name" matches at two levels.
    expect(treeLines(levels, new Set(), "rel").map((l) => l.node.path)).toEqual([
      "contact",
      "contact.relationship",
    ]);
    expect(treeLines(levels, new Set(), "NAME").map((l) => l.node.path)).toEqual([
      "name",
      "contact",
      "contact.name",
    ]);
    expect(treeLines(levels, new Set(), "zzz")).toEqual([]);
  });
});
