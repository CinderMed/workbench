/**
 * The JSON Schemas that are contracts of the workbench (CLAUDE.md, "Technical rules").
 * The files in ./schemas are verbatim copies of fixtures/fml-examples; a test keeps them in sync.
 * They are imported as JSON modules, so the package does no I/O (ADR-0001).
 */
import manifest from "./schemas/manifest.schema.json" with { type: "json" };
import mappingProject from "./schemas/mapping-project.schema.json" with { type: "json" };
import normalization from "./schemas/normalization.schema.json" with { type: "json" };

/** Project file schema (H3), format 1.3.0. */
export const projectSchema: Readonly<Record<string, unknown>> = mappingProject;
/** Normalization specification schema, format 1.2.0. */
export const normalizationSchema: Readonly<Record<string, unknown>> = normalization;
/** Export package manifest schema, format 1.0.0. */
export const manifestSchema: Readonly<Record<string, unknown>> = manifest;

export const PROJECT_FORMAT_VERSION = "1.3.0";
export const NORMALIZATION_FORMAT_VERSION = "1.2.0";
export const MANIFEST_FORMAT_VERSION = "1.0.0";
