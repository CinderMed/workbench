/**
 * Stable result codes of the integrity rules (specification, "Rules the schema cannot express").
 * Clients key on these strings: never rename one, add a new code instead.
 */
export const IntegrityCode = {
  /** Rule 1: an internal id is used by more than one object. */
  DUPLICATE_ID: "DUPLICATE_ID",
  /** Rule 1: an `…Id` field points to no object. */
  DANGLING_REFERENCE: "DANGLING_REFERENCE",
  /** Rule 1: an `…Id` field points to an object of another kind. */
  WRONG_REFERENCE_KIND: "WRONG_REFERENCE_KIND",
  /** Rule 2: two roles share `resourceType` + `index`. */
  DUPLICATE_INSTANCE_KEY: "DUPLICATE_INSTANCE_KEY",
  /** Rule 2: two mapping rows share the `R-nnn` code. */
  DUPLICATE_ROW_CODE: "DUPLICATE_ROW_CODE",
  /** Rule 3: a column or section belongs to another table than the object that uses it. */
  SOURCE_MISMATCH: "SOURCE_MISMATCH",
  /** Rule 4: a path uses a named slice that the role does not declare. */
  SLICE_NOT_DECLARED: "SLICE_NOT_DECLARED",
  /** Rule 5: a reference to a role in another table has no `via` relation. */
  REFERENCE_NEEDS_VIA: "REFERENCE_NEEDS_VIA",
  /** Rule 5: the `via` relation does not link the table of the row to the table of the target. */
  VIA_RELATION_MISMATCH: "VIA_RELATION_MISMATCH",
  /** Rule 5: a column of the target `idRule` cannot be reached through the `via` relation. */
  ID_RULE_NOT_REACHABLE: "ID_RULE_NOT_REACHABLE",
  /** Rule 6: a value map has a `sourceValue` that a column using it does not allow. */
  VALUE_MAP_SOURCE_VALUE_UNKNOWN: "VALUE_MAP_SOURCE_VALUE_UNKNOWN",
  /**
   * Rule 6: a categorical or multiple-choice column used by a value map has no allowed values, so
   * a value outside the map would be lost silently (normalization 1.2.0 checks only listed values).
   */
  VALUE_MAP_COLUMN_WITHOUT_ALLOWED_VALUES: "VALUE_MAP_COLUMN_WITHOUT_ALLOWED_VALUES",
  /**
   * Rule 6: a value map is used by a column that is not categorical, multipleChoice or boolean:
   * the column has no list of values to map, so it must be declared categorical.
   */
  VALUE_MAP_COLUMN_TYPE_NOT_ALLOWED: "VALUE_MAP_COLUMN_TYPE_NOT_ALLOWED",
  /**
   * Rule 6: an allowed value of a column (not a missing value) has no entry in a value map that the
   * column uses; the entry may carry a code or an action.
   */
  VALUE_MAP_INCOMPLETE: "VALUE_MAP_INCOMPLETE",
  /** Rule 7: the generated id can exceed 64 characters. */
  ID_TOO_LONG: "ID_TOO_LONG",
  /** Rule 7: a literal part or the separator of an `idRule` has characters outside `[A-Za-z0-9.-]`. */
  ID_INVALID_CHARACTERS: "ID_INVALID_CHARACTERS",
  /** Rule 8: `repeat: eachValue` on a row whose column is not `multipleChoice`. */
  REPEAT_REQUIRES_MULTIPLE_CHOICE: "REPEAT_REQUIRES_MULTIPLE_CHOICE",
  /** Rule 9: an allowed value of a column does not fit the column's type (e.g. `Sì` in a `boolean` column). */
  ALLOWED_VALUE_TYPE_MISMATCH: "ALLOWED_VALUE_TYPE_MISMATCH",
  /**
   * Rule 9: a categorical or multiple-choice column has an allowed-values list that is empty once
   * missing values are removed, so the normalization would reject every value.
   */
  ALLOWED_VALUES_EMPTY: "ALLOWED_VALUES_EMPTY",
} as const;

export type IntegrityCode = (typeof IntegrityCode)[keyof typeof IntegrityCode];
