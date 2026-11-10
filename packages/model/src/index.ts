/** Project JSON Schemas, generated types and integrity rules */
export const packageName = "@cindermed/model";

export {
  MANIFEST_FORMAT_VERSION,
  NORMALIZATION_FORMAT_VERSION,
  PROJECT_FORMAT_VERSION,
  manifestSchema,
  normalizationSchema,
  projectSchema,
} from "./schemas.js";
export {
  SCHEMA_VIOLATION,
  validateManifestSchema,
  validateNormalizationSchema,
  validateProjectSchema,
} from "./schema-validation.js";
export {
  isValid,
  type ObjectKind,
  type Severity,
  type ValidationResult,
} from "./validation-result.js";
