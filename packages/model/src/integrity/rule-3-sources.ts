// Rule 3: a row and its role belong to the same table, except references with `via`.
// The same check covers every column or section that an object of a table uses: the columns of a
// role (multiplicity, condition, id rule), the row key, the section of a column and the columns
// of each side of a relation. References to roles of another table are checked by rule 5.
import type { ValidationResult } from "../validation-result.js";
import { IntegrityCode } from "./codes.js";
import type { ProjectIndex } from "./project-index.js";
import { error } from "./result.js";

export function checkSources(index: ProjectIndex): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const reference of index.references) {
    if (reference.sourceId === undefined) continue;
    const target = index.ids
      .get(reference.targetId)
      ?.find((entry) => entry.kind === reference.expected);
    // Missing targets and wrong kinds are rule 1.
    if (target?.sourceId === undefined || target.sourceId === reference.sourceId) continue;
    results.push(
      error(
        IntegrityCode.SOURCE_MISMATCH,
        reference.owner,
        reference.field,
        `${reference.expected} '${reference.targetId}' belongs to table '${target.sourceId}', not to '${reference.sourceId}'`,
      ),
    );
  }
  return results;
}
