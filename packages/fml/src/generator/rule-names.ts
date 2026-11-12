/**
 * Names of the rules generated for a value map (specification, "Translation rules", value map
 * row). `StructureMap.group.rule.name` is a FHIR `id` (`[A-Za-z0-9.-]{1,64}`), so a value map
 * becomes one rule per source value, named `<row code>-<value>`:
 *
 * - characters outside `[A-Za-z0-9.-]` become `-` (`Sì` → `R-002-S-`, `N/A` → `R-002-N-A`); the
 *   verified names stay as they are (`R-006-1`, `R-011--1`, `R-002-Female`);
 * - names are cut to 64 characters;
 * - when two values of the same map would get the same name, the later ones get a numeric suffix,
 *   in the order of the map's entries, after cutting the name so that it still fits in 64
 *   characters (`N/A` → `R-002-N-A`, `N-A` → `R-002-N-A2`).
 */
import { ruleName, type RuleName } from "../fml-ast.js";

/** Maximum length of a FHIR `id`, and so of a rule name. */
export const MAX_RULE_NAME_LENGTH = 64;

/** `<row code>-<value>` with every character outside `[A-Za-z0-9.-]` replaced by `-`, cut to 64. */
export function baseValueRuleName(rowCode: string, sourceValue: string): string {
  return `${rowCode}-${sourceValue}`
    .replace(/[^A-Za-z0-9.-]/gu, "-")
    .slice(0, MAX_RULE_NAME_LENGTH);
}

/**
 * Rule names of the values of one value map in one row, in entry order: the sanitized value, plus
 * a numeric suffix (2, 3, ...) when the name is already taken, the base cut so the name fits.
 */
export function valueRuleNames(rowCode: string, sourceValues: readonly string[]): RuleName[] {
  const taken = new Set<string>();
  return sourceValues.map((value) => {
    const base = baseValueRuleName(rowCode, value);
    let name = base;
    for (let suffix = 2; taken.has(name); suffix++) {
      const tail = String(suffix);
      name = `${base.slice(0, MAX_RULE_NAME_LENGTH - tail.length)}${tail}`;
    }
    taken.add(name);
    return ruleName(name);
  });
}
