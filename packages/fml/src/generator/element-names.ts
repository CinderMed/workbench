/**
 * Element names (specification, "Generator contract"): the name of a column in the logical model,
 * in the normalized row and in the FML comes from the column name.
 *
 * - every character outside `[A-Za-z0-9_]` becomes `_` (one per code point);
 * - the prefix `c` is added, as many times as needed, until the first character is a letter and the
 *   second, if there is one, is a letter or a digit: the HL7 FHIRPath parser rejects a name whose
 *   second character is `_` (#134; tooling/hl7-probes);
 * - a trailing `_` is added to the four words the grammar rejects (`share`, `default`, `log`, `then`);
 * - names are cut to 64 characters, the limit of normalization.schema.json;
 * - a collision within the table gets a numeric suffix (`name2`, `name3`, ...) on the first 60 characters.
 *
 * Examples: `log` → `log_`, `Pain level (0-10)` → `Pain_level__0_10_`, `2nd visit` → `c2nd_visit`,
 * `a b` → `ca_b`, `_private` → `cc_private`, `a` → `a`.
 */
import { RESERVED_WORDS, ident, type Identifier } from "../fml-ast.js";

/**
 * Names a column can never take, because the normalized row already uses them: `id` and
 * `extension` are inherited from Element, the base of the R4 logical model, and `resourceType`
 * is the property the normalizer writes on every row. A column with one of these names is
 * treated like a collision (`id` → `id2`).
 */
export const RESERVED_ELEMENT_NAMES: ReadonlySet<string> = new Set([
  "id",
  "extension",
  "resourceType",
]);

/** Maximum length of an element name (normalization.schema.json, ElementName). */
export const MAX_ELEMENT_NAME_LENGTH = 64;
const COLLISION_BASE_LENGTH = 60;

/** A letter, then (if the name is longer) a letter or a digit. */
const HL7_SAFE_START = /^[A-Za-z](?:[A-Za-z0-9]|$)/;

/** Element name of a single column name, before collisions are resolved. */
export function baseElementName(columnName: string): string {
  let name = columnName.replace(/[^A-Za-z0-9_]/gu, "_");
  while (!HL7_SAFE_START.test(name)) name = `c${name}`;
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
