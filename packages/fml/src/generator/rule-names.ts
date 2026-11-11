/**
 * Names of the rules generated for a value map (specification, "Translation rules", value map
 * row). A value map becomes one rule per source value, named `<row code>-<value>`:
 *
 * - characters outside `[A-Za-z0-9_.-]` become `_` (`Sì` → `R-002-S_`, `N/A` → `R-002-N_A`); the
 *   verified names stay as they are (`R-006-1`, `R-011--1`, `R-002-Female`);
 * - when two values of the same map would get the same name, the later ones get a numeric suffix,
 *   in the order of the map's entries (`Sì` → `R-002-S_`, `Sí` → `R-002-S_2`, `S_2` → `R-002-S_22`
 *   if `R-002-S_2` is already taken).
 */
import { ruleName, type RuleName } from "../fml-ast.js";

/** `<row code>-<value>` with every character outside `[A-Za-z0-9_.-]` replaced by `_`. */
export function baseValueRuleName(rowCode: string, sourceValue: string): string {
  return `${rowCode}-${sourceValue.replace(/[^A-Za-z0-9_.-]/gu, "_")}`;
}

/**
 * Rule names of the values of one value map in one row, in entry order: the sanitized value, plus
 * a numeric suffix (2, 3, ...) when the name is already taken.
 */
export function valueRuleNames(rowCode: string, sourceValues: readonly string[]): RuleName[] {
  const taken = new Set<string>();
  return sourceValues.map((value) => {
    const base = baseValueRuleName(rowCode, value);
    let name = base;
    for (let suffix = 2; taken.has(name); suffix++) name = `${base}${String(suffix)}`;
    taken.add(name);
    return ruleName(name);
  });
}
