/**
 * Quality level of project validation (specification, "Project validation"): warnings that do not
 * block the export. Run it on a project that already passed the schema check.
 *
 * The first check (normalization 1.2.0, ADR-0005 addendum): a categorical or multiple-choice
 * column without allowed values. Its values are not checked during conversion. A column that a
 * value map uses is an integrity error instead (rule 6), so it is not reported here.
 */
import type { ProjectFile } from "../generated/project.js";
import { rowValueMaps } from "../integrity/project-index.js";
import type { ValidationResult } from "../validation-result.js";

/**
 * Stable result codes of the quality checks. Clients key on these strings: never rename one, add a
 * new code instead.
 */
export const QualityCode = {
  /** A categorical or multiple-choice column has no allowed values: its values are not checked. */
  ALLOWED_VALUES_MISSING: "ALLOWED_VALUES_MISSING",
} as const;

export type QualityCode = (typeof QualityCode)[keyof typeof QualityCode];

/** Checks the quality warnings and returns them in project order. */
export function checkQuality(project: ProjectFile): ValidationResult[] {
  const usedByValueMap = new Set(
    project.mappings.flatMap((row) => rowValueMaps(row).map((use) => use.columnId)),
  );
  const results: ValidationResult[] = [];
  for (const source of project.sources) {
    for (const column of source.columns) {
      const listed = column.dataType === "categorical" || column.dataType === "multipleChoice";
      if (!listed || column.allowedValues !== undefined || usedByValueMap.has(column.id)) continue;
      results.push({
        severity: "warning",
        code: QualityCode.ALLOWED_VALUES_MISSING,
        objectKind: "column",
        id: column.id,
        field: "allowedValues",
        message: `column '${column.name}' is ${column.dataType} without allowed values: values will not be checked during conversion`,
      });
    }
  }
  return results;
}
