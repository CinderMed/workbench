import { isProjectFile, type ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json";
import motuProject from "../../../../fixtures/fml-examples/motu/project.json";
import { gridRows, roleName, valuesSummary } from "./rows";

/** The value, failing the test when it is missing. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing value in test");
  return value;
}

const load = (document: unknown): ProjectFile => {
  const copy = JSON.parse(JSON.stringify(document)) as unknown;
  if (!isProjectFile(copy)) throw new Error("not a project");
  return copy;
};

describe("gridRows", () => {
  it("lists every Metastra column, its rows, then the rows without a column", () => {
    const project = load(metastraProject);
    const rows = gridRows(project, project.sources[0]);
    const withColumn = rows.filter((r) => r.column !== undefined);
    const columnsShown = new Set(withColumn.map((r) => r.column?.id));
    expect(columnsShown.size).toBe(11);
    expect(rows.filter((r) => r.mapping !== undefined)).toHaveLength(16);
    // Columns come in table order; rows without a column (references) come last.
    const firstColumnRow = rows.findIndex((r) => r.column === undefined);
    expect(rows.slice(firstColumnRow).every((r) => r.column === undefined)).toBe(true);
    expect(rows.slice(firstColumnRow).every((r) => r.mapping?.transform.kind === "reference")).toBe(
      true,
    );
  });

  it("shows a column with no rows as one empty line", () => {
    const project = load(metastraProject);
    const column = project.sources[0].columns[0];
    project.mappings = project.mappings.filter((m) => m.columnId !== column.id);
    const rows = gridRows(project, project.sources[0]);
    expect(rows[0]).toEqual({ key: `column:${column.id}`, column });
  });

  it("keeps each MOTU table to its own columns and roles", () => {
    const project = load(motuProject);
    for (const source of project.sources) {
      const ids = new Set(source.columns.map((c) => c.id));
      const rows = gridRows(project, source);
      expect(rows.every((r) => r.column === undefined || ids.has(r.column.id))).toBe(true);
      expect(new Set(rows.filter((r) => r.column).map((r) => r.column?.id)).size).toBe(
        source.columns.length,
      );
    }
    const total = project.sources.reduce(
      (n, s) => n + gridRows(project, s).filter((r) => r.mapping).length,
      0,
    );
    expect(total).toBe(project.mappings.length);
  });
});

describe("valuesSummary and roleName", () => {
  it("summarises value maps, units and reference targets", () => {
    const project = load(metastraProject);
    const kinds = project.mappings.map((m) => valuesSummary(project, m).kind);
    expect(kinds).toContain("valueMap");
    expect(kinds).toContain("target");
    expect(valuesSummary(project, undefined)).toEqual({ kind: "none" });
    expect(roleName({ ...must(project.instances[0]), label: "patient" })).toMatch(
      /^Patient\[0\] · patient$/,
    );
  });
});
