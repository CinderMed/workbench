import { describe, expect, it } from "vitest";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json" with { type: "json" };
import type { MappingRow, ProjectFile } from "../generated/project.js";
import { checkIntegrity } from "../integrity/index.js";
import { isProjectFile } from "../schema-validation.js";
import { type Change, applyChanges, nextRowCode, objectKey } from "./index.js";

function metastra(): ProjectFile {
  const copy = JSON.parse(JSON.stringify(metastraProject)) as unknown;
  if (!isProjectFile(copy)) throw new Error("metastra is not a valid project");
  return copy;
}
const base = metastra();
const firstRow = (): MappingRow => {
  const row = base.mappings[0];
  if (row === undefined) throw new Error("metastra has rows");
  return row;
};
const ok = (project: ProjectFile, changes: Change[]): ProjectFile => {
  const result = applyChanges(project, changes);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.project;
};

describe("applyChanges", () => {
  it("creates, updates and deletes rows, and never modifies its input", () => {
    const before = JSON.stringify(base);
    const row: MappingRow = { ...firstRow(), id: "map_new001", code: nextRowCode(base) };
    const created = ok(base, [{ op: "create", kind: "mapping", value: row }]);
    expect(created.mappings.at(-1)).toEqual(row);
    const updated = ok(created, [
      { op: "update", kind: "mapping", id: row.id, value: { ...row, path: "note.text" } },
    ]);
    expect(updated.mappings.find((r) => r.id === row.id)?.path).toBe("note.text");
    const deleted = ok(updated, [{ op: "delete", kind: "mapping", id: row.id }]);
    expect(deleted.mappings).toEqual(base.mappings);
    expect(JSON.stringify(base)).toBe(before);
  });

  it("reports the objects it touched", () => {
    const result = applyChanges(base, [
      { op: "delete", kind: "mapping", id: firstRow().id },
      {
        op: "update",
        kind: "project",
        id: base.project.id,
        value: { ...base.project, name: "M2" },
      },
    ]);
    expect(result.ok && result.touched).toEqual([
      { op: "delete", kind: "mapping", id: firstRow().id },
      { op: "update", kind: "project", id: base.project.id },
    ]);
  });

  it("refuses a result that does not match the schema, with the schema errors", () => {
    const result = applyChanges(base, [
      {
        op: "update",
        kind: "mapping",
        id: firstRow().id,
        value: { ...firstRow(), path: "Not A Path" },
      },
    ]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("invalid");
    expect(!result.ok && result.reason === "invalid" && result.results[0]).toMatchObject({
      code: "SCHEMA_VIOLATION",
      objectKind: "mapping",
    });
  });

  it("keeps work in progress with integrity errors: a role deleted while rows still use it", () => {
    const role = base.instances[0];
    if (role === undefined) throw new Error("metastra has roles");
    const project = ok(base, [{ op: "delete", kind: "instance", id: role.id }]);
    expect(project.instances.some((i) => i.id === role.id)).toBe(false);
    expect(checkIntegrity(project).some((r) => r.severity === "error")).toBe(true);
  });

  it("applies a batch all or nothing", () => {
    const result = applyChanges(base, [
      { op: "delete", kind: "mapping", id: firstRow().id },
      { op: "delete", kind: "mapping", id: "map_missing" },
    ]);
    expect(result).toEqual({
      ok: false,
      reason: "missing",
      kind: "mapping",
      id: "map_missing",
      message: "no mapping with id map_missing",
    });
  });

  it("refuses creating an object that exists and changing an id", () => {
    expect(
      applyChanges(base, [{ op: "create", kind: "mapping", value: firstRow() }]),
    ).toMatchObject({ ok: false, reason: "exists" });
    expect(
      applyChanges(base, [
        {
          op: "update",
          kind: "mapping",
          id: firstRow().id,
          value: { ...firstRow(), id: "map_other" },
        },
      ]),
    ).toMatchObject({ ok: false, reason: "refused" });
  });

  it("keeps a table's columns when the table is updated, and manages columns on their own", () => {
    const [source] = base.sources;
    const { columns, ...table } = source;
    const renamed = ok(base, [
      { op: "update", kind: "source", id: source.id, value: { ...table, name: "Visit" } },
    ]);
    expect(renamed.sources[0].columns).toEqual(columns);
    const added = ok(base, [
      {
        op: "create",
        kind: "column",
        parentId: source.id,
        value: { id: "col_extra1", name: "extra", dataType: "string" },
      },
    ]);
    expect(added.sources[0].columns.at(-1)?.id).toBe("col_extra1");
    const typed = ok(added, [
      {
        op: "update",
        kind: "column",
        id: "col_extra1",
        value: { id: "col_extra1", name: "extra", dataType: "integer" },
      },
    ]);
    expect(typed.sources[0].columns.at(-1)?.dataType).toBe("integer");
    expect(
      applyChanges(base, [
        {
          op: "create",
          kind: "column",
          parentId: "src_nope00",
          value: { id: "col_x00001", name: "x", dataType: "string" },
        },
      ]),
    ).toMatchObject({ ok: false, reason: "missing" });
  });

  it("refuses removing the last column of a table and the last table", () => {
    const single: ProjectFile = {
      ...base,
      sources: [{ ...base.sources[0], columns: [base.sources[0].columns[0]] }],
    };
    expect(
      applyChanges(single, [{ op: "delete", kind: "column", id: base.sources[0].columns[0].id }]),
    ).toMatchObject({ ok: false, reason: "refused", message: "a table has at least one column" });
    expect(
      applyChanges(base, [{ op: "delete", kind: "source", id: base.sources[0].id }]),
    ).toMatchObject({ ok: false, reason: "refused", message: "a project has at least one table" });
  });

  it("only updates the project settings", () => {
    expect(
      applyChanges(base, [{ op: "delete", kind: "project", id: base.project.id }]),
    ).toMatchObject({ ok: false, reason: "refused" });
  });
});

describe("nextRowCode and objectKey", () => {
  it("gives the next free code and a store key", () => {
    expect(nextRowCode(base)).toBe("R-017");
    expect(nextRowCode({ ...base, mappings: [] })).toBe("R-001");
    expect(objectKey("mapping", "map_x")).toBe("mapping/map_x");
  });
});
