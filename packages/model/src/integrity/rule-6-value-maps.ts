// Rule 6: the `sourceValue`s of a value map match the allowed values of the columns that use it.
// A column uses a value map through a `valueMap` transform (its `columnId`) or through a `quantity`
// transform (`unitColumnId` with `unitValueMapId`). Columns without allowed values (free text) are
// not checked; the missing-value codes of a column are accepted as source values (ADR-0005).
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
      if (column?.allowedValues === undefined || valueMap === undefined) continue;
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
