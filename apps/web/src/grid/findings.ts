/**
 * Where validation results show in the grid (D7 inline): every result points to an object and a
 * field (`objectKind`, `id`, `field`), and the grid colours the cell that holds it. A row's own
 * results go to the cell of their field; a column's results to the cells of that column; a role's
 * to the Role cells of its rows; a value map's to the Values cells of the rows that use it.
 * Results that point nowhere in a table (the project, a role no row uses) have no cell: the list
 * of all findings shows them.
 */
import type { MappingRow, ProjectFile, Severity, ValidationResult } from "@cindermed/model";
import { type GridRow, gridRows } from "./rows";

export type CellColumn = "code" | "column" | "type" | "role" | "element" | "transform" | "values";

export interface CellFinding {
  readonly severity: Severity;
  /** Every result on the cell, errors first. */
  readonly items: readonly ValidationResult[];
}

/** A cell of the grid: its table, row and column. */
export interface CellAddress {
  readonly sourceId: string;
  readonly rowKey: string;
  readonly column: CellColumn;
}

/** The cell of a mapping row's field. */
function rowColumn(field: string | undefined): CellColumn {
  if (field === undefined) return "code";
  if (field === "path" || field.startsWith("path.") || field === "repeat") return "element";
  if (field === "instanceId") return "role";
  if (field === "columnId") return "column";
  if (
    field === "transform.valueMapId" ||
    field === "transform.unit" ||
    field === "transform.system"
  )
    return "values";
  if (field.startsWith("transform")) return "transform";
  return "code";
}

const valueMapOf = (row: MappingRow | undefined): string | undefined =>
  row?.transform.kind === "valueMap" ? row.transform.valueMapId : undefined;

/** The cells of `rows` a result points to. */
function cellsOf(
  rows: readonly GridRow[],
  result: ValidationResult,
): { rowKey: string; column: CellColumn }[] {
  if (result.id === undefined) return [];
  const cells: { rowKey: string; column: CellColumn }[] = [];
  for (const row of rows) {
    switch (result.objectKind) {
      case "mapping":
        if (row.mapping?.id === result.id)
          cells.push({ rowKey: row.key, column: rowColumn(result.field) });
        break;
      case "column":
        if (row.column?.id === result.id) cells.push({ rowKey: row.key, column: "column" });
        break;
      case "instance":
        if (row.mapping?.instanceId === result.id) cells.push({ rowKey: row.key, column: "role" });
        break;
      case "valueMap":
      case "valueMapEntry":
        if (valueMapOf(row.mapping) === result.id)
          cells.push({ rowKey: row.key, column: "values" });
        break;
      default:
        break;
    }
  }
  return cells;
}

const bySeverity = (a: ValidationResult, b: ValidationResult) =>
  Number(b.severity === "error") - Number(a.severity === "error");

/** The findings of each cell, by `<row key>/<column>`. */
export function cellFindings(
  rows: readonly GridRow[],
  results: readonly ValidationResult[],
): Map<string, CellFinding> {
  const cells = new Map<string, ValidationResult[]>();
  for (const result of results)
    for (const { rowKey, column } of cellsOf(rows, result)) {
      const key = `${rowKey}/${column}`;
      cells.set(key, [...(cells.get(key) ?? []), result]);
    }
  return new Map(
    [...cells].map(([key, items]) => [
      key,
      {
        severity: items.some((r) => r.severity === "error") ? "error" : "warning",
        items: [...items].sort(bySeverity),
      },
    ]),
  );
}

/** The first cell a result shows in, in any table; undefined when it has none. */
export function locateFinding(
  project: ProjectFile,
  result: ValidationResult,
): CellAddress | undefined {
  for (const source of project.sources) {
    const [cell] = cellsOf(gridRows(project, source), result);
    if (cell !== undefined) return { sourceId: source.id, ...cell };
  }
  return undefined;
}
