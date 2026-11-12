/**
 * The compact definition index (ADR-0013): what the workbench keeps of the StructureDefinitions of
 * a FHIR version and its packages. A manifest lists every type and profile with the file that
 * holds it; each file holds one type or profile, loaded only when needed. The API serves these
 * files as they are, so the browser never loads a whole core package.
 *
 * Format version 1.0.0. A reader accepts every 1.x.y index; a new optional field is a minor
 * version, anything else a major one.
 */

export const INDEX_FORMAT_VERSION = "1.0.0";
const SUPPORTED_MAJOR = "1.";

/** A FHIR package, as `<id>#<version>` in the manifest. */
export interface PackageRef {
  readonly id: string;
  readonly version: string;
}

export type DefinitionKind = "resource" | "complex-type" | "primitive-type";
const KINDS: readonly string[] = ["resource", "complex-type", "primitive-type"];

/** One type (`types/<name>.json`) or profile (`profiles/<package>/<id>.json`) in the manifest. */
export interface IndexEntry {
  readonly url: string;
  /** StructureDefinition.name. */
  readonly name: string;
  /** The type it defines or constrains (`Patient`, `Quantity`). */
  readonly type: string;
  readonly kind: DefinitionKind;
  readonly abstract: boolean;
  /** Absent for the roots (`Resource`, `Element`, `Base`). */
  readonly derivation?: "specialization" | "constraint";
  readonly baseDefinition?: string;
  /** The package it comes from, as `<id>#<version>`. */
  readonly package: string;
  /** Path of its document, relative to the manifest. */
  readonly file: string;
  /** SHA-256 (hex) of the document's UTF-8 bytes. */
  readonly sha256: string;
  /** Size of the document in bytes. */
  readonly size: number;
}

/** `index.json`. */
export interface IndexManifest {
  readonly indexFormat: string;
  readonly fhirVersion: string;
  /** The packages the index was built from: the core package first, then the others by id. */
  readonly packages: readonly PackageRef[];
  /** Sorted by `file`. */
  readonly entries: readonly IndexEntry[];
}

export interface ElementType {
  readonly code: string;
  readonly profile?: readonly string[];
  readonly targetProfile?: readonly string[];
}

export interface ElementBinding {
  readonly strength: "required" | "extensible" | "preferred" | "example";
  readonly valueSet?: string;
}

export interface ElementSlicing {
  readonly discriminator?: readonly { readonly type: string; readonly path: string }[];
  readonly rules: "closed" | "open" | "openAtEnd";
  readonly ordered?: boolean;
}

/** A fixed or pattern value: `type` is the FHIR type name (`uri`, `CodeableConcept`). */
export interface ElementValue {
  readonly type: string;
  readonly value: unknown;
}

/**
 * One element of a snapshot. Fields left out when they carry nothing: `path` when it equals `id`,
 * `isModifier` and `mustSupport` when false, and every absent optional field.
 */
export interface IndexElement {
  readonly id: string;
  readonly path?: string;
  readonly min: number;
  readonly max: string;
  readonly type?: readonly ElementType[];
  readonly contentReference?: string;
  readonly short?: string;
  readonly binding?: ElementBinding;
  readonly sliceName?: string;
  readonly slicing?: ElementSlicing;
  readonly fixed?: ElementValue;
  readonly pattern?: ElementValue;
  readonly isModifier?: true;
  readonly mustSupport?: true;
}

/** The document of one type or profile. */
export interface TypeDocument {
  readonly indexFormat: string;
  readonly url: string;
  readonly name: string;
  readonly type: string;
  readonly kind: DefinitionKind;
  readonly abstract: boolean;
  readonly derivation?: "specialization" | "constraint";
  readonly baseDefinition?: string;
  /** The snapshot, in its order. */
  readonly elements: readonly IndexElement[];
}

/** The path of an element: `path` when given, else its `id`. */
export function elementPath(element: IndexElement): string {
  return element.path ?? element.id;
}

/** Problems found while building, opening or loading an index. */
export interface IndexIssue {
  readonly severity: "error" | "warning";
  readonly code: IndexIssueCode;
  readonly message: string;
  /** The definition or file concerned, when there is one. */
  readonly subject?: string;
}

export type IndexIssueCode =
  | "INDEX_FORMAT_UNSUPPORTED"
  | "INDEX_MALFORMED"
  | "INDEX_ENTRY_UNKNOWN"
  | "INDEX_DOCUMENT_MALFORMED"
  | "INDEX_DOCUMENT_DIGEST_MISMATCH"
  | "INDEX_DOCUMENT_UNAVAILABLE"
  | "PACKAGE_FHIR_VERSION_MISMATCH"
  | "CORE_PACKAGE_MISSING"
  | "DEFINITION_DUPLICATE"
  | "DEFINITION_WITHOUT_SNAPSHOT"
  | "DEFINITION_MALFORMED";

export type Result<T> =
  | { readonly ok: true; readonly value: T; readonly issues: readonly IndexIssue[] }
  | { readonly ok: false; readonly issues: readonly IndexIssue[] };

// ---------------------------------------------------------------------------------------------
// Structural checks: documents may come over the network, so they are checked before use.

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const isString = (value: unknown): value is string => typeof value === "string";
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);
const optional = (value: unknown, check: (v: unknown) => boolean): boolean =>
  value === undefined || check(value);
const isDerivation = (value: unknown): boolean =>
  value === "specialization" || value === "constraint";
const isKind = (value: unknown): value is DefinitionKind =>
  isString(value) && KINDS.includes(value);

/** `true` when an index of this format version can be read. */
export function isSupportedFormat(version: unknown): boolean {
  return isString(version) && version.startsWith(SUPPORTED_MAJOR);
}

function isEntry(value: unknown): value is IndexEntry {
  return (
    isObject(value) &&
    isString(value["url"]) &&
    isString(value["name"]) &&
    isString(value["type"]) &&
    isKind(value["kind"]) &&
    typeof value["abstract"] === "boolean" &&
    optional(value["derivation"], isDerivation) &&
    optional(value["baseDefinition"], isString) &&
    isString(value["package"]) &&
    isString(value["file"]) &&
    isString(value["sha256"]) &&
    /^[0-9a-f]{64}$/.test(value["sha256"]) &&
    typeof value["size"] === "number"
  );
}

function isPackageRef(value: unknown): value is PackageRef {
  return isObject(value) && isString(value["id"]) && isString(value["version"]);
}

function isElementType(value: unknown): value is ElementType {
  return (
    isObject(value) &&
    isString(value["code"]) &&
    optional(value["profile"], isStringArray) &&
    optional(value["targetProfile"], isStringArray)
  );
}

function isElementValue(value: unknown): value is ElementValue {
  return isObject(value) && isString(value["type"]) && "value" in value;
}

function isElement(value: unknown): value is IndexElement {
  if (!isObject(value)) return false;
  const binding = value["binding"];
  const slicing = value["slicing"];
  return (
    isString(value["id"]) &&
    optional(value["path"], isString) &&
    typeof value["min"] === "number" &&
    isString(value["max"]) &&
    optional(value["type"], (t) => Array.isArray(t) && t.every(isElementType)) &&
    optional(value["contentReference"], isString) &&
    optional(value["short"], isString) &&
    optional(binding, (b) => isObject(b) && isString(b["strength"])) &&
    optional(value["sliceName"], isString) &&
    optional(slicing, (s) => isObject(s) && isString(s["rules"])) &&
    optional(value["fixed"], isElementValue) &&
    optional(value["pattern"], isElementValue) &&
    optional(value["isModifier"], (v) => v === true) &&
    optional(value["mustSupport"], (v) => v === true)
  );
}

/** Reads `index.json` (already parsed). */
export function parseManifest(value: unknown): Result<IndexManifest> {
  if (!isObject(value)) return malformed("INDEX_MALFORMED", "the manifest is not an object");
  if (!isSupportedFormat(value["indexFormat"]))
    return failure({
      severity: "error",
      code: "INDEX_FORMAT_UNSUPPORTED",
      message: `index format ${JSON.stringify(value["indexFormat"])} is not supported (expected ${SUPPORTED_MAJOR}x)`,
    });
  const packages = value["packages"];
  const entries = value["entries"];
  if (
    !isString(value["fhirVersion"]) ||
    !Array.isArray(packages) ||
    !packages.every(isPackageRef) ||
    !Array.isArray(entries) ||
    !entries.every(isEntry)
  )
    return malformed("INDEX_MALFORMED", "the manifest does not have the index format");
  return { ok: true, value: value as unknown as IndexManifest, issues: [] };
}

/** Reads one type document (already parsed). */
export function parseTypeDocument(value: unknown, subject?: string): Result<TypeDocument> {
  const valid =
    isObject(value) &&
    isSupportedFormat(value["indexFormat"]) &&
    isString(value["url"]) &&
    isString(value["name"]) &&
    isString(value["type"]) &&
    isKind(value["kind"]) &&
    typeof value["abstract"] === "boolean" &&
    optional(value["derivation"], isDerivation) &&
    optional(value["baseDefinition"], isString) &&
    Array.isArray(value["elements"]) &&
    value["elements"].every(isElement);
  if (!valid)
    return malformed(
      "INDEX_DOCUMENT_MALFORMED",
      "the document does not have the index format",
      subject,
    );
  return { ok: true, value: value as unknown as TypeDocument, issues: [] };
}

function malformed(code: IndexIssueCode, message: string, subject?: string): Result<never> {
  return failure({
    severity: "error",
    code,
    message,
    ...(subject === undefined ? {} : { subject }),
  });
}

export function failure(...issues: IndexIssue[]): Result<never> {
  return { ok: false, issues };
}
