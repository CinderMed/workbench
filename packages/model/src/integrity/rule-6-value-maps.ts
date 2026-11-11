// Rule 6: a value map and the columns that use it agree (ADR-0005 and its addenda).
// A column uses a value map through a `valueMap` transform (its `columnId`) or through a `quantity`
// transform (`unitColumnId` with `unitValueMapId`).
//
// - Only `categorical`, `multipleChoice` and `boolean` columns can use a value map
//   (VALUE_MAP_COLUMN_TYPE_NOT_ALLOWED, on the row): a free-text or numeric column has no list of
//   values to map, so it must be declared categorical.
// - A categorical or multiple-choice column used by a value map must have allowed values
//   (VALUE_MAP_COLUMN_WITHOUT_ALLOWED_VALUES): the normalization (1.2.0) rejects a value outside
//   the list, so no value can reach the map without a rule and be lost silently.
// - Every `sourceValue` is an allowed value of the column, or one of its missing-value codes
//   (VALUE_MAP_SOURCE_VALUE_UNKNOWN).
// - Every allowed value that is not a missing value has an entry in the map
//   (VALUE_MAP_INCOMPLETE). The entry may carry a code or an action (skipInstance, setElement,
//   absent): any entry counts. Values are compared as the normalization compares them: after NFC
//   and trim, case-sensitive.
import type { Column, MappingRow, ValueMap } from "../generated/project.js";
import type { ValidationResult } from "../validation-result.js";
import { canonicalText } from "../values/index.js";
import { IntegrityCode } from "./codes.js";
import { rowValueMaps, type ProjectIndex } from "./project-index.js";
import { error } from "./result.js";

/** Column types that can use a value map. */
const VALUE_MAP_COLUMN_TYPES: ReadonlySet<Column["dataType"]> = new Set([
  "categorical",
  "multipleChoice",
  "boolean",
]);

/** Field of the row that names the column using the map. */
function columnField(row: MappingRow): string {
  return row.transform.kind === "quantity" ? "transform.unitColumnId" : "columnId";
}

function unknownSourceValues(
  row: MappingRow,
  column: Column,
  valueMap: ValueMap,
  allowedCodes: readonly string[],
): { index: number; result: ValidationResult }[] {
  const allowed = new Set([...allowedCodes, ...(column.missingValues ?? [])]);
  return valueMap.entries.flatMap((entry, i) =>
    allowed.has(entry.sourceValue)
      ? []
      : [
          {
            index: i,
            result: error(
              IntegrityCode.VALUE_MAP_SOURCE_VALUE_UNKNOWN,
              { objectKind: "valueMap", id: valueMap.id },
              `entries.${String(i)}.sourceValue`,
              `'${entry.sourceValue}' is not an allowed value of column '${column.name}' (row ${row.code})`,
            ),
          },
        ],
  );
}

/** Allowed values (canonical, not missing) that no entry of the map covers, in column order. */
function uncoveredValues(column: Column, valueMap: ValueMap, allowedCodes: readonly string[]) {
  const missing = new Set((column.missingValues ?? []).map(canonicalText));
  const covered = new Set(valueMap.entries.map((entry) => canonicalText(entry.sourceValue)));
  const values = allowedCodes.map(canonicalText);
  return [...new Set(values)].filter(
    (value) => value !== "" && !missing.has(value) && !covered.has(value),
  );
}

export function checkValueMaps(index: ProjectIndex): ValidationResult[] {
  const results: ValidationResult[] = [];
  const reported = new Set<string>();
  const once = (key: string, result: ValidationResult): void => {
    if (reported.has(key)) return;
    reported.add(key);
    results.push(result);
  };

  for (const row of index.project.mappings) {
    for (const { columnId, valueMapId } of rowValueMaps(row)) {
      const column = columnId === undefined ? undefined : index.columns.get(columnId)?.column;
      const valueMap = index.valueMaps.get(valueMapId);
      if (column === undefined || valueMap === undefined) continue;

      if (!VALUE_MAP_COLUMN_TYPES.has(column.dataType)) {
        once(
          `${row.id}\u001f${valueMap.id}\u001ftype`,
          error(
            IntegrityCode.VALUE_MAP_COLUMN_TYPE_NOT_ALLOWED,
            { objectKind: "mapping", id: row.id },
            columnField(row),
            `value map '${valueMap.name}' needs a categorical, multipleChoice or boolean column, but column '${column.name}' is ${column.dataType}: declare the column categorical, with its allowed values`,
          ),
        );
        continue;
      }

      if (column.allowedValues === undefined) {
        if (column.dataType !== "boolean") {
          once(
            `${column.id}\u001fwithout-allowed-values`,
            error(
              IntegrityCode.VALUE_MAP_COLUMN_WITHOUT_ALLOWED_VALUES,
              { objectKind: "column", id: column.id },
              "allowedValues",
              `column '${column.name}' is used by value map '${valueMap.name}' (row ${row.code}) but has no allowed values: a value outside the map would be lost silently`,
            ),
          );
        }
        continue;
      }

      const allowedCodes = column.allowedValues.map((value) => value.code);
      for (const { index: i, result } of unknownSourceValues(row, column, valueMap, allowedCodes)) {
        once(`${valueMap.id}\u001f${column.id}\u001f${String(i)}`, result);
      }

      const uncovered = uncoveredValues(column, valueMap, allowedCodes);
      if (uncovered.length > 0) {
        const list = uncovered.map((value) => `'${value}'`).join(", ");
        once(
          `${valueMap.id}\u001f${column.id}\u001fincomplete`,
          error(
            IntegrityCode.VALUE_MAP_INCOMPLETE,
            { objectKind: "valueMap", id: valueMap.id },
            "entries",
            `value map '${valueMap.name}' has no entry for ${list} of column '${column.name}' (row ${row.code}): add an entry with a code or an action (skipInstance, setElement, absent)`,
          ),
        );
      }
    }
  }

  return results;
}
