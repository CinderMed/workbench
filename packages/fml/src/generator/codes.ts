/**
 * Result codes of the generator: project features the schema and the integrity rules accept but
 * the generator cannot translate (yet). They block the export like any other error.
 */
export const GeneratorCode = {
  /** A source name is not a valid FML group name (`^[A-Za-z][A-Za-z0-9]*$`): it names the map, its main group and the logical model. */
  SOURCE_NAME_NOT_FML_NAME: "SOURCE_NAME_NOT_FML_NAME",
  /** A multiple choice spread over several columns (`multiValue.encoding = expanded`, B9) is V2. */
  MULTI_VALUE_EXPANDED_UNSUPPORTED: "MULTI_VALUE_EXPANDED_UNSUPPORTED",
  /** A role has no `idRule`: without an id it can never be created. */
  ROLE_WITHOUT_ID_RULE: "ROLE_WITHOUT_ID_RULE",
  /** An `idRule` has only literal parts: every row would get the same id, and the normalization needs at least one column. */
  ID_RULE_WITHOUT_COLUMNS: "ID_RULE_WITHOUT_COLUMNS",
  /** A literal part follows a column part: the normalization writes the literals first, then the encoded columns. */
  ID_LITERAL_AFTER_COLUMN: "ID_LITERAL_AFTER_COLUMN",
} as const;

export type GeneratorCode = (typeof GeneratorCode)[keyof typeof GeneratorCode];

/** A project that breaks the integrity rules (e.g. a dangling id): validate before generating. */
export class GeneratorInputError extends Error {
  override readonly name = "GeneratorInputError";
}
