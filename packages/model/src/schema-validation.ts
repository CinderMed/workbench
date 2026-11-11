/**
 * Schema-level validation (specification, "Project validation": level "Schema").
 * Ajv errors are turned into `ValidationResult`s that point to the object that owns the field.
 */
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ExportManifest } from "./generated/manifest.js";
import type { NormalizationSpec } from "./generated/normalization.js";
import type { ProjectFile } from "./generated/project.js";
import { manifestSchema, normalizationSchema, projectSchema } from "./schemas.js";
import type { ObjectKind, ValidationResult } from "./validation-result.js";

export const SCHEMA_VIOLATION = "SCHEMA_VIOLATION";

// ajv-formats is CommonJS: under Node ESM the default import is `module.exports`.
const addFormats = addFormatsModule.default;

// Strict about unknown keywords, but not about style lints (strictRequired, strictTypes): the contract
// schemas are verbatim copies and must not be rewritten, and the lints would only log noise.
const ajv = new Ajv2020({
  allErrors: true,
  strictSchema: true,
  strictTypes: false,
  strictRequired: false,
});
addFormats(ajv);

// Compiled lazily: most callers need only the project validator.
const compiled = new Map<Readonly<Record<string, unknown>>, ValidateFunction>();
function validatorFor(schema: Readonly<Record<string, unknown>>): ValidateFunction {
  let validate = compiled.get(schema);
  if (validate === undefined) {
    validate = ajv.compile(schema);
    compiled.set(schema, validate);
  }
  return validate;
}

/** Array properties of the project file whose items are objects with an internal `id`. */
const COLLECTION_KINDS: Readonly<Record<string, ObjectKind>> = {
  sources: "source",
  sections: "section",
  columns: "column",
  sourceRelations: "sourceRelation",
  instances: "instance",
  mappings: "mapping",
  valueMaps: "valueMap",
  entries: "valueMapEntry",
  templates: "template",
};

interface Owner {
  objectKind: ObjectKind;
  id?: string;
  /** Path segments below the owner. */
  rest: string[];
}

function decodePointer(pointer: string): string[] {
  if (pointer === "") return [];
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function child(value: unknown, segment: string): unknown {
  if (Array.isArray(value)) return value[Number(segment)];
  if (isRecord(value)) return value[segment];
  return undefined;
}

/** Walks the JSON Pointer and returns the deepest known object (with an `id`) that contains it. */
function findOwner(document: unknown, segments: string[], rootKind: ObjectKind): Owner {
  let owner: Owner = { objectKind: rootKind, rest: segments };
  if (rootKind !== "project") return owner;
  let value = document;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] ?? "";
    const parentKey = segments[i - 1];
    value = child(value, segment);
    const kind = parentKey === undefined ? undefined : COLLECTION_KINDS[parentKey];
    if (kind !== undefined && /^\d+$/.test(segment) && isRecord(value)) {
      const id = value["id"];
      owner = {
        objectKind: kind,
        ...(typeof id === "string" ? { id } : {}),
        rest: segments.slice(i + 1),
      };
    }
  }
  return owner;
}

function toResult(error: ErrorObject, document: unknown, rootKind: ObjectKind): ValidationResult {
  const segments = decodePointer(error.instancePath);
  const owner = findOwner(document, segments, rootKind);
  const params: Record<string, unknown> = error.params;
  const missing = params["missingProperty"];
  const extra = params["additionalProperty"];
  const fieldSegments = [...owner.rest];
  if (typeof missing === "string") fieldSegments.push(missing);
  if (typeof extra === "string") fieldSegments.push(extra);
  const field = fieldSegments.join(".");
  const where = error.instancePath === "" ? "/" : error.instancePath;
  let message = `${where}: ${error.message ?? "is invalid"}`;
  if (typeof extra === "string") message += ` ('${extra}')`;
  return {
    severity: "error",
    code: SCHEMA_VIOLATION,
    objectKind: owner.objectKind,
    ...(owner.id === undefined ? {} : { id: owner.id }),
    ...(field === "" ? {} : { field }),
    message,
  };
}

function run(
  schema: Readonly<Record<string, unknown>>,
  document: unknown,
  rootKind: ObjectKind,
): ValidationResult[] {
  const validate = validatorFor(schema);
  if (validate(document)) return [];
  return (validate.errors ?? []).map((error) => toResult(error, document, rootKind));
}

/** Validates a parsed project file against the project JSON Schema (format 1.x). */
export function validateProjectSchema(document: unknown): ValidationResult[] {
  return run(projectSchema, document, "project");
}

/** Validates a parsed normalization specification against its JSON Schema. */
export function validateNormalizationSchema(document: unknown): ValidationResult[] {
  return run(normalizationSchema, document, "normalization");
}

/** Validates a parsed export manifest against its JSON Schema. */
export function validateManifestSchema(document: unknown): ValidationResult[] {
  return run(manifestSchema, document, "manifest");
}

/** Type guard: true when the document is a valid project file for the schema (integrity not checked). */
export function isProjectFile(document: unknown): document is ProjectFile {
  return validateProjectSchema(document).length === 0;
}

/** Type guard: true when the document is a valid normalization specification. */
export function isNormalizationSpec(document: unknown): document is NormalizationSpec {
  return validateNormalizationSchema(document).length === 0;
}

/** Type guard: true when the document is a valid export manifest. */
export function isExportManifest(document: unknown): document is ExportManifest {
  return validateManifestSchema(document).length === 0;
}
