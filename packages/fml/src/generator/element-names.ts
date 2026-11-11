/**
 * Element names (specification, "Generator contract"): the name of a column in the logical model,
 * in the normalized row and in the FML comes from the column name.
 *
 * - every character outside `[A-Za-z0-9_]` becomes `_` (one per code point);
 * - the prefix `c` is added if the name does not start with a letter;
 * - a trailing `_` is added to the four words the grammar rejects (`share`, `default`, `log`, `then`);
 * - names are cut to 64 characters, the limit of normalization.schema.json;
 * - a collision within the table gets a numeric suffix (`name2`, `name3`, ...) on the first 60 characters.
 *
 * Examples: `log` → `log_`, `Pain level (0-10)` → `Pain_level__0_10_`, `2nd visit` → `c2nd_visit`.
 */
import { RESERVED_WORDS, ident, type Identifier } from "../fml-ast.js";

/** Maximum length of an element name (normalization.schema.json, ElementName). */
export const MAX_ELEMENT_NAME_LENGTH = 64;
const COLLISION_BASE_LENGTH = 60;

/** Element name of a single column name, before collisions are resolved. */
export function baseElementName(columnName: string): string {
  let name = columnName.replace(/[^A-Za-z0-9_]/gu, "_");
  if (!/^[A-Za-z]/.test(name)) name = `c${name}`;
  if (RESERVED_WORDS.has(name)) name = `${name}_`;
  return name.slice(0, MAX_ELEMENT_NAME_LENGTH);
}

/**
 * Assigns element names in order, avoiding the names in `taken` and the names assigned before.
 * `taken` is updated with every name assigned.
 */
export function assignElementName(columnName: string, taken: Set<string>): Identifier {
  let name = baseElementName(columnName);
  const base = name.slice(0, COLLISION_BASE_LENGTH);
  for (let suffix = 2; taken.has(name); suffix++) name = `${base}${String(suffix)}`;
  taken.add(name);
  return ident(name);
}
