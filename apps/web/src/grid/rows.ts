/**
 * The rows of the mapping grid for one table (D1): every mapping row that reads a column of the
 * table, in column order, and one empty row for each column that no row reads yet, so every
 * column of the table is on screen. Rows without a column (constants, references) of the table's
 * roles come last. Pure: the grid renders what this gives.
 */
import type { Column, Instance, MappingRow, ProjectFile, Source, ValueMap } from "@cindermed/model";

export interface GridRow {
  /** Stable key: the mapping row id, or `column:<id>` for a column without rows. */
  readonly key: string;
  readonly mapping?: MappingRow;
  readonly column?: Column;
  readonly role?: Instance;
}

/** What the Values / code cell summarises, formatted by the grid. */
export type ValuesSummary =
  | { readonly kind: "none" }
  | { readonly kind: "valueMap"; readonly name: string; readonly entries: number }
  | { readonly kind: "unit"; readonly unit: string }
  | { readonly kind: "unitColumn"; readonly column: string }
  | { readonly kind: "system"; readonly system: string }
  | { readonly kind: "constant"; readonly value: string }
  | { readonly kind: "target"; readonly role: string };

/** The visible name of a role: `Type[n] · label` (specification, roles). */
export function roleName(role: Instance): string {
  const key = `${role.resourceType}[${String(role.index)}]`;
  return role.label === undefined ? key : `${key} · ${role.label}`;
}

export function gridRows(project: ProjectFile, source: Source): GridRow[] {
  const roles = new Map(project.instances.map((i) => [i.id, i]));
  const columns = new Map(source.columns.map((c) => [c.id, c]));
  const byColumn = new Map<string, MappingRow[]>();
  const withoutColumn: MappingRow[] = [];
  for (const row of project.mappings) {
    if (row.columnId !== undefined) {
      if (!columns.has(row.columnId)) continue; // Another table's column.
      byColumn.set(row.columnId, [...(byColumn.get(row.columnId) ?? []), row]);
    } else if (roles.get(row.instanceId)?.sourceId === source.id) withoutColumn.push(row);
  }
  const of = (row: MappingRow): GridRow => {
    const role = roles.get(row.instanceId);
    const column = row.columnId === undefined ? undefined : columns.get(row.columnId);
    return {
      key: row.id,
      mapping: row,
      ...(column === undefined ? {} : { column }),
      ...(role === undefined ? {} : { role }),
    };
  };
  return [
    ...source.columns.flatMap((column) => {
      const rows = byColumn.get(column.id);
      return rows === undefined ? [{ key: `column:${column.id}`, column }] : rows.map(of);
    }),
    ...withoutColumn.map(of),
  ];
}

export function valuesSummary(project: ProjectFile, row: MappingRow | undefined): ValuesSummary {
  if (row === undefined) return { kind: "none" };
  const t = row.transform;
  switch (t.kind) {
    case "valueMap": {
      const map: ValueMap | undefined = project.valueMaps.find((v) => v.id === t.valueMapId);
      return map === undefined
        ? { kind: "none" }
        : { kind: "valueMap", name: map.name, entries: map.entries.length };
    }
    case "quantity": {
      if (t.unit !== undefined) return { kind: "unit", unit: t.unit.code };
      const unitColumn = project.sources
        .flatMap((s) => s.columns)
        .find((c) => c.id === t.unitColumnId);
      return unitColumn === undefined
        ? { kind: "none" }
        : { kind: "unitColumn", column: unitColumn.name };
    }
    case "coding":
      return { kind: "system", system: t.system };
    case "constant":
      return { kind: "constant", value: "value" in t.value ? String(t.value.value) : t.value.type };
    case "reference": {
      const target = project.instances.find((i) => i.id === t.targetInstanceId);
      return target === undefined ? { kind: "none" } : { kind: "target", role: roleName(target) };
    }
    default:
      return { kind: "none" };
  }
}
