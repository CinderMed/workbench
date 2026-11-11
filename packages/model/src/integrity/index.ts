/**
 * Integrity level of project validation (specification, "Project validation"): the rules the
 * JSON Schema cannot express (9 since project format 1.3.0). Run it on a project that already passed
 * the schema check.
 */
import type { ProjectFile } from "../generated/project.js";
import type { ValidationResult } from "../validation-result.js";
import { buildIndex } from "./project-index.js";
import { checkIds } from "./rule-1-ids.js";
import { checkKeys } from "./rule-2-keys.js";
import { checkSources } from "./rule-3-sources.js";
import { checkSlices } from "./rule-4-slices.js";
import { checkReferences } from "./rule-5-references.js";
import { checkValueMaps } from "./rule-6-value-maps.js";
import { checkResourceIds } from "./rule-7-resource-ids.js";
import { checkRepeat } from "./rule-8-repeat.js";
import { checkAllowedValues } from "./rule-9-allowed-values.js";

export { IntegrityCode } from "./codes.js";
export { MAX_ID_LENGTH, idLength } from "./rule-7-resource-ids.js";

const RULES = [
  checkIds,
  checkKeys,
  checkSources,
  checkSlices,
  checkReferences,
  checkValueMaps,
  checkResourceIds,
  checkRepeat,
  checkAllowedValues,
] as const;

/** Checks the integrity rules 1–9 and returns every violation, in rule order, without duplicates. */
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
