// Rule 6: the `sourceValue`s of a value map match the allowed values of the columns that use it.
// A column uses a value map through a `valueMap` transform (its `columnId`) or through a `quantity`
// transform (`unitColumnId` with `unitValueMapId`). The missing-value codes of a column are accepted
// as source values (ADR-0005).
//
// A categorical or multiple-choice column used by a value map must have allowed values (ADR-0005
// addendum, normalization 1.2.0): the normalization rejects a value outside the list, so no value
// can reach the map without a rule and be lost silently. Columns of other types are not checked.
import type { ValidationResult } from "../validation-result.js";
import { IntegrityCode } from "./codes.js";
import { rowValueMaps, type ProjectIndex } from "./project-index.js";
import { error } from "./result.js";

export function checkValueMaps(index: ProjectIndex): ValidationResult[] {
  const results: ValidationResult[] = [];
  const reported = new Set<string>();

  for (const row of index.project.mappings) {
    for (const { columnId, valueMapId } of rowValueMaps(row)) {
      const column = columnId === undefined ? undefined : index.columns.get(columnId)?.column;
      const valueMap = index.valueMaps.get(valueMapId);
      if (column === undefined || valueMap === undefined) continue;
      if (column.allowedValues === undefined) {
        const key = `${column.id}\u001fwithout-allowed-values`;
        const listed = column.dataType === "categorical" || column.dataType === "multipleChoice";
        if (listed && !reported.has(key)) {
          reported.add(key);
          results.push(
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
      const allowed = new Set([
        ...column.allowedValues.map((value) => value.code),
        ...(column.missingValues ?? []),
      ]);
      valueMap.entries.forEach((entry, i) => {
        const key = `${valueMap.id}\u001f${column.id}\u001f${String(i)}`;
        if (allowed.has(entry.sourceValue) || reported.has(key)) return;
        reported.add(key);
        results.push(
          error(
            IntegrityCode.VALUE_MAP_SOURCE_VALUE_UNKNOWN,
            { objectKind: "valueMap", id: valueMap.id },
            `entries.${String(i)}.sourceValue`,
            `'${entry.sourceValue}' is not an allowed value of column '${column.name}' (row ${row.code})`,
          ),
        );
      });
    }
  }

  return results;
}
