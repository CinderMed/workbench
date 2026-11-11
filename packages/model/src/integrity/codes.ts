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
} as const;

export type IntegrityCode = (typeof IntegrityCode)[keyof typeof IntegrityCode];
