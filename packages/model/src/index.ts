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
  isExportManifest,
  isNormalizationSpec,
  isProjectFile,
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

// Types generated from the JSON Schemas (ADR-0004). The project types are the main vocabulary
// and are exported by name; normalization and manifest share some names (e.g. Column), so their
// definitions are grouped under a namespace and only the root types are exported by name.
export type * from "./generated/project.js";
export type { NormalizationSpec } from "./generated/normalization.js";
export type * as Normalization from "./generated/normalization.js";
export type { ExportManifest } from "./generated/manifest.js";
export type * as Manifest from "./generated/manifest.js";

export { IntegrityCode, MAX_ID_LENGTH, checkIntegrity, idLength } from "./integrity/index.js";
