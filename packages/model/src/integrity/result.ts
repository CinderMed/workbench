import type { ValidationResult } from "../validation-result.js";
import type { IntegrityCode } from "./codes.js";
import type { Owner } from "./project-index.js";

/** Builds an integrity error on an object. */
export function error(
  code: IntegrityCode,
  owner: Owner,
  field: string,
  message: string,
): ValidationResult {
  return { severity: "error", code, objectKind: owner.objectKind, id: owner.id, field, message };
}
