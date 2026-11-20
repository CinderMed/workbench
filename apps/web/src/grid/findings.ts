/**
 * Where validation results show in the grid (D7 inline): every result points to an object and a
 * field (`objectKind`, `id`, `field`), and the grid colours the cell that holds it. A row's own
 * results go to the cell of their field; a column's results to the cells of that column; a role's
 * to the Role cells of its rows; a value map's to the Values cells of the rows that use it.
 * Results that point nowhere in this table are left to the summary.
 */
import type { MappingRow, Severity, ValidationResult } from "@cindermed/model";
import type { GridRow } from "./rows";

export type CellColumn = "code" | "column" | "type" | "role" | "element" | "transform" | "values";

export interface CellFinding {
  readonly severity: Severity;
  readonly messages: readonly string[];
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

/** The findings of each cell, by `<row key>/<column>`. */
export function cellFindings(
  rows: readonly GridRow[],
  results: readonly ValidationResult[],
): Map<string, CellFinding> {
  const cells = new Map<string, { severity: Severity; messages: string[] }>();
  const add = (key: string, result: ValidationResult) => {
    const cell = cells.get(key) ?? { severity: "warning", messages: [] };
    if (result.severity === "error") cell.severity = "error";
    cell.messages.push(result.message);
    cells.set(key, cell);
  };
  for (const result of results) {
    if (result.id === undefined) continue;
    for (const row of rows) {
      switch (result.objectKind) {
        case "mapping":
          if (row.mapping?.id === result.id) add(`${row.key}/${rowColumn(result.field)}`, result);
          break;
        case "column":
          if (row.column?.id === result.id) add(`${row.key}/column`, result);
          break;
        case "instance":
          if (row.mapping?.instanceId === result.id) add(`${row.key}/role`, result);
          break;
        case "valueMap":
        case "valueMapEntry":
          if (valueMapOf(row.mapping) === result.id) add(`${row.key}/values`, result);
          break;
        default:
          break;
      }
    }
  }
  return cells;
}
