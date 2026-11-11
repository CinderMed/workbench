/**
 * Shape shared by every validation level (schema, integrity, FHIR, quality).
 * Codes are stable, so clients can key on them (specification, "Project validation").
 */

export type Severity = "error" | "warning";

/** Kind of object a result points to; the grid uses it with `id` to highlight the right cell. */
export type ObjectKind =
  | "project"
  | "source"
  | "section"
  | "column"
  | "sourceRelation"
  | "instance"
  | "mapping"
  | "valueMap"
  | "valueMapEntry"
  | "template"
  | "normalization"
  | "manifest";

export interface ValidationResult {
  severity: Severity;
  /** Stable machine-readable code, e.g. `SCHEMA_VIOLATION`, `DUPLICATE_ID`. */
  code: string;
  objectKind: ObjectKind;
  /** Internal id of the object, when the result points to one. */
  id?: string;
  /** Dotted path of the offending field inside the object, e.g. `multiplicity.kind`. */
  field?: string;
  message: string;
}

/** True when no result has severity `error` (warnings do not block). */
export function isValid(results: readonly ValidationResult[]): boolean {
  return results.every((result) => result.severity !== "error");
}
