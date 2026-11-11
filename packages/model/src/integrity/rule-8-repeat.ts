// Rule 8 (structural part): `repeat: eachValue` is used only with `multipleChoice` columns.
// That the target element repeats needs the FHIR definitions: module 3 (D7, ADR-0005).
import type { ValidationResult } from "../validation-result.js";
import { IntegrityCode } from "./codes.js";
import type { ProjectIndex } from "./project-index.js";
import { error } from "./result.js";

export function checkRepeat(index: ProjectIndex): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const row of index.project.mappings) {
    if (row.repeat?.kind !== "eachValue") continue;
    const column = row.columnId === undefined ? undefined : index.columns.get(row.columnId)?.column;
    // A dangling column is rule 1.
    if (row.columnId !== undefined && column === undefined) continue;
    if (column?.dataType === "multipleChoice") continue;
    const what =
      column === undefined
        ? "a row without a column"
        : `column '${column.name}' (${column.dataType})`;
    results.push(
      error(
        IntegrityCode.REPEAT_REQUIRES_MULTIPLE_CHOICE,
        { objectKind: "mapping", id: row.id },
        "repeat",
        `repeat eachValue needs a multipleChoice column, but ${row.code} has ${what}`,
      ),
    );
  }
  return results;
}
