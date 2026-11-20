import { isProjectFile, type ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json";
import motuProject from "../../../../fixtures/fml-examples/motu/project.json";
import { gridLines } from "./groups";
import { gridRows, roleName } from "./rows";

const load = (document: unknown): ProjectFile => {
  const copy = JSON.parse(JSON.stringify(document)) as unknown;
  if (!isProjectFile(copy)) throw new Error("not a project");
  return copy;
};
const headers = (lines: ReturnType<typeof gridLines>) =>
  lines.flatMap((l) => (l.kind === "group" ? [[l.label ?? "(none)", l.count]] : []));

describe("gridLines", () => {
  const project = load(metastraProject);
  const source = project.sources[0];
  const rows = gridRows(project, source);

  it("groups by section in section order, rows without a section last", () => {
    const lines = gridLines(project, source, rows, "section", new Set());
    const sections = [...(source.sections ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const named = headers(lines).filter(([label]) => label !== "(none)");
    expect(named.map(([label]) => label)).toEqual(
      sections.map((s) => s.name).filter((name) => named.some(([label]) => label === name)),
    );
    expect(headers(lines).reduce((n, [, count]) => n + Number(count), 0)).toBe(rows.length);
    // Every row once, right after its header.
    expect(lines.filter((l) => l.kind === "row")).toHaveLength(rows.length);
    const last = headers(lines).at(-1);
    expect(last?.[0]).toBe("(none)"); // References have no column, so no section.
  });

  it("groups by role in role order, rows without a role (unmapped columns) last", () => {
    const unmapped = load(metastraProject);
    const column = unmapped.sources[0].columns[0];
    unmapped.mappings = unmapped.mappings.filter((m) => m.columnId !== column.id);
    const all = gridRows(unmapped, unmapped.sources[0]);
    const lines = gridLines(unmapped, unmapped.sources[0], all, "role", new Set());
    const roles = unmapped.instances.map(roleName);
    const labels = headers(lines).map(([label]) => label);
    expect(labels.slice(0, -1)).toEqual(roles.filter((r) => labels.includes(r)));
    expect(headers(lines).at(-1)).toEqual(["(none)", all.filter((r) => !r.mapping).length]);
    expect(all.filter((r) => !r.mapping).some((r) => r.column?.id === column.id)).toBe(true);
  });

  it("leaves a collapsed group's rows out, and keeps its header and count", () => {
    const open = gridLines(project, source, rows, "role", new Set());
    const first = open[0];
    if (first?.kind !== "group") throw new Error("a header first");
    const closed = gridLines(project, source, rows, "role", new Set([first.key]));
    expect(closed[0]).toMatchObject({ kind: "group", collapsed: true, count: first.count });
    expect(closed[1]?.kind).toBe("group");
    expect(closed.length).toBe(open.length - first.count);
  });

  it("gives a flat list when grouping by section a table without sections (MOTU)", () => {
    const motu = load(motuProject);
    const table = motu.sources[0];
    const all = gridRows(motu, table);
    expect(gridLines(motu, table, all, "section", new Set()).every((l) => l.kind === "row")).toBe(
      true,
    );
    expect(gridLines(motu, table, all, "role", new Set()).some((l) => l.kind === "group")).toBe(
      true,
    );
  });
});
