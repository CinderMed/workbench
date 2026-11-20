import type { Instance } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import { patientProject, syntheticDefinitions } from "../validation/synthetic-definitions";
import { cardinality, loadLevels, roleDefinition, treeLines, withSlices } from "./tree";

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("missing");
  return value;
};

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

  it("shows a role's named slices after their repeating element, opened like it (D4)", async () => {
    const { defs, fetch } = syntheticDefinitions();
    const coding = {
      type: "CodeableConcept" as const,
      coding: { system: "http://snomed.info/sct", code: "1284852002" },
    };
    const slices: NonNullable<Instance["slices"]> = [
      {
        id: "slc_nrs",
        path: "component",
        name: "nrs",
        discriminator: [{ path: "code", value: coding }],
      },
      {
        id: "slc_vas",
        path: "component",
        name: "vas",
        discriminator: [{ path: "code", value: coding }],
      },
      // A slice on an element that does not repeat shows nowhere (validation reports it).
      {
        id: "slc_bad",
        path: "status",
        name: "x",
        discriminator: [{ path: "code", value: coding }],
      },
    ];
    const loaded = await loadLevels(defs, fetch, "Observation", "", new Map(), 4, slices);
    if ("message" in loaded) throw new Error(loaded.message);
    // The backbone slices are loaded with the root, so the search finds inside them.
    expect(loaded.levels.get("component[nrs]")?.map((n) => n.path)).toEqual([
      "component[nrs].code",
      "component[nrs].valueInteger",
      "component[nrs].valueString",
    ]);
    const root = treeLines(loaded.levels, new Set(), "", slices);
    expect(root.map((l) => [l.node.name, cardinality(l.node), l.node.sliceId])).toEqual([
      ["status", "1..1", undefined],
      ["code", "1..1", undefined],
      ["component", "0..*", undefined],
      ["component[nrs]", "0..1", "slc_nrs"],
      ["component[vas]", "0..1", "slc_vas"],
    ]);
    expect(
      treeLines(loaded.levels, new Set(["component[nrs]"]), "", slices).map((l) => l.node.path),
    ).toContain("component[nrs].valueInteger");
    expect(treeLines(loaded.levels, new Set(), "valueint", slices).map((l) => l.node.path)).toEqual(
      [
        "component",
        "component.valueInteger",
        "component[nrs]",
        "component[nrs].valueInteger",
        "component[vas]",
        "component[vas].valueInteger",
      ],
    );
    // Without slices the level is unchanged; a profile slice of the same name is not repeated.
    const level = loaded.levels.get("") ?? [];
    expect(withSlices(level, [])).toBe(level);
    const profiled = [
      ...level,
      {
        ...must(level[2]),
        name: "component[nrs]",
        path: "component[nrs]",
        sliceName: "nrs",
      },
    ];
    expect(withSlices(profiled, slices).filter((n) => n.path === "component[nrs]")).toHaveLength(1);
  });
});
