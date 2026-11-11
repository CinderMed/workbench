/**
 * Integrity level of project validation (specification, "Project validation"): the 8 rules the
 * JSON Schema cannot express. Run it on a project that already passed the schema check.
 * Rules 1–3 for now; rules 4–8 follow in a separate pull request (issue #63).
 */
import type { ProjectFile } from "../generated/project.js";
import type { ValidationResult } from "../validation-result.js";
import { buildIndex } from "./project-index.js";
import { checkIds } from "./rule-1-ids.js";
import { checkKeys } from "./rule-2-keys.js";
import { checkSources } from "./rule-3-sources.js";

export { IntegrityCode } from "./codes.js";

const RULES = [checkIds, checkKeys, checkSources] as const;

/** Checks the integrity rules and returns every violation, in rule order, without duplicates. */
export function checkIntegrity(project: ProjectFile): ValidationResult[] {
  const index = buildIndex(project);
  const seen = new Set<string>();
  const results: ValidationResult[] = [];
  for (const rule of RULES) {
    for (const result of rule(index)) {
      const key = [result.code, result.objectKind, result.id, result.field, result.message].join(
        "\u001f",
      );
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(result);
    }
  }
  return results;
}
