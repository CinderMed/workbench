// Rule 1: every id is unique in the file, and every `…Id` field points to an existing object
// of the right kind.
import type { ValidationResult } from "../validation-result.js";
import { IntegrityCode } from "./codes.js";
import type { ProjectIndex } from "./project-index.js";
import { error } from "./result.js";

export function checkIds(index: ProjectIndex): ValidationResult[] {
  const results: ValidationResult[] = [];

  for (const [id, entries] of index.ids) {
    const [first, ...others] = entries;
    if (first === undefined) continue;
    for (const entry of others) {
      results.push(
        error(
          IntegrityCode.DUPLICATE_ID,
          entry.owner,
          entry.field,
          `id '${id}' (${entry.kind}) is already used by a ${first.kind}`,
        ),
      );
    }
  }

  for (const reference of index.references) {
    const targets = index.ids.get(reference.targetId);
    if (targets === undefined) {
      results.push(
        error(
          IntegrityCode.DANGLING_REFERENCE,
          reference.owner,
          reference.field,
          `${reference.field} points to '${reference.targetId}', but no ${reference.expected} has this id`,
        ),
      );
    } else if (!targets.some((target) => target.kind === reference.expected)) {
      const kinds = [...new Set(targets.map((target) => target.kind))].join(", ");
      results.push(
        error(
          IntegrityCode.WRONG_REFERENCE_KIND,
          reference.owner,
          reference.field,
          `${reference.field} must point to a ${reference.expected}, but '${reference.targetId}' is a ${kinds}`,
        ),
      );
    }
  }

  return results;
}
