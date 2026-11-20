import { isProjectFile, type ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import motuProject from "../../../../fixtures/fml-examples/motu/project.json";
import { defaultIdRule, describeIdRule, nextIndex, rowsUsing } from "./role-defaults";

const motu = (): ProjectFile => {
  const copy = JSON.parse(JSON.stringify(motuProject)) as unknown;
  if (!isProjectFile(copy)) throw new Error("not a project");
  return copy;
};

describe("role defaults", () => {
  it("gives the next free index of a resource type", () => {
    const project = motu();
    const encounters = project.instances.filter((i) => i.resourceType === "Encounter");
    expect(nextIndex(project, "Encounter")).toBe(Math.max(...encounters.map((i) => i.index)) + 1);
    expect(nextIndex(project, "Immunization")).toBe(0);
    const only = encounters[0];
    if (only === undefined || encounters.length !== 1) return;
    expect(nextIndex(project, "Encounter", only.id)).toBe(0);
  });

  it("builds the id rule from the table's row key, named after the role", () => {
    const project = motu();
    const stay = project.sources.find((s) => s.rowKey?.length === 2);
    if (stay === undefined) throw new Error("MOTU has a table with a two-column key");
    const rule = defaultIdRule(project, stay.id, "Observation", 1);
    expect(rule).toEqual({
      parts: [
        { literal: "observation1" },
        ...(stay.rowKey ?? []).map((columnId) => ({ columnId })),
      ],
    });
    const names = (stay.rowKey ?? []).map(
      (id) => `<${stay.columns.find((c) => c.id === id)?.name ?? id}>`,
    );
    expect(describeIdRule(project, rule)).toBe(["observation1", ...names].join("-"));
  });

  it("gives no id rule for a table without a row key, as cindermed init writes it", () => {
    const project = motu();
    const [first, ...rest] = project.sources;
    const noKey = { ...first };
    delete noKey.rowKey;
    project.sources = [noKey, ...rest];
    expect(defaultIdRule(project, first.id, "Patient", 0)).toBeUndefined();
    expect(describeIdRule(project, undefined)).toBeUndefined();
  });

  it("counts the rows that write to a role or reference it", () => {
    const project = motu();
    const role = project.instances[0];
    if (role === undefined) throw new Error("MOTU has roles");
    const expected = project.mappings.filter(
      (m) =>
        m.instanceId === role.id ||
        (m.transform.kind === "reference" && m.transform.targetInstanceId === role.id),
    ).length;
    expect(rowsUsing(project, role.id)).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });
});
