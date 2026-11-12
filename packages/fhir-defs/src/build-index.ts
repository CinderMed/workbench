/**
 * Builds the compact definition index (ADR-0013) from the StructureDefinitions of a FHIR version's
 * core package and of any other packages. No I/O: the caller reads the packages and passes their
 * resources already parsed.
 */
import { corePackage } from "./core-packages.js";
import { sha256Hex, utf8Length } from "./hash.js";
import {
  INDEX_FORMAT_VERSION,
  type DefinitionKind,
  type ElementBinding,
  type ElementSlicing,
  type ElementType,
  type ElementValue,
  type IndexElement,
  type IndexEntry,
  type IndexIssue,
  type IndexManifest,
  type PackageRef,
  type Result,
  type TypeDocument,
  failure,
} from "./index-format.js";

/** A FHIR package as read by the caller. */
export interface PackageContents {
  readonly id: string;
  readonly version: string;
  /** `fhirVersions` of its package.json. */
  readonly fhirVersions: readonly string[];
  /** Its resources, parsed. Everything that is not a StructureDefinition is ignored. */
  readonly resources: Iterable<unknown>;
}

export interface BuiltIndex {
  readonly manifest: IndexManifest;
  /** `index.json`, as served. */
  readonly manifestText: string;
  /** Type documents by their path in the manifest (`types/Patient.json`), as served. */
  readonly files: ReadonlyMap<string, string>;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const KINDS: readonly string[] = ["resource", "complex-type", "primitive-type"];

/** A StructureDefinition the index keeps, with its package. */
interface Candidate {
  readonly sd: Json;
  readonly snapshot: readonly Json[];
  readonly pkg: PackageRef;
  readonly kind: DefinitionKind;
}

/**
 * Builds the index. Kept: resources, complex and primitive types, and their profiles. Left out:
 * logical models and extension definitions (extensions cannot be mapped in the MVP), each without
 * an issue. A kept definition without a snapshot is left out with a warning, since the workbench
 * does not generate snapshots.
 */
export function buildIndex(
  fhirVersion: string,
  packages: readonly PackageContents[],
): Result<BuiltIndex> {
  const core = corePackage(fhirVersion);
  if (core === undefined || !packages.some((p) => p.id === core.id && p.version === core.version))
    return failure({
      severity: "error",
      code: "CORE_PACKAGE_MISSING",
      message:
        core === undefined
          ? `FHIR version ${fhirVersion} is not supported`
          : `the core package ${core.id}#${core.version} is missing`,
    });
  const issues: IndexIssue[] = [];
  for (const p of packages)
    if (!p.fhirVersions.includes(fhirVersion))
      issues.push({
        severity: "error",
        code: "PACKAGE_FHIR_VERSION_MISMATCH",
        message: `package ${p.id}#${p.version} is for FHIR ${p.fhirVersions.join(", ") || "(none)"}, not ${fhirVersion}`,
        subject: `${p.id}#${p.version}`,
      });
  if (issues.length > 0) return { ok: false, issues };

  const ordered = [...packages].sort((a, b) =>
    a.id === core.id
      ? -1
      : b.id === core.id
        ? 1
        : a.id.localeCompare(b.id, "en") || a.version.localeCompare(b.version, "en"),
  );
  const candidates = collect(ordered, issues);
  const primitives = new Set(
    candidates.filter((c) => c.kind === "primitive-type").map((c) => String(c.sd["type"])),
  );

  const entries: IndexEntry[] = [];
  const files = new Map<string, string>();
  const urls = new Set<string>();
  for (const candidate of candidates) {
    const { sd, pkg } = candidate;
    const url = String(sd["url"]);
    const file =
      sd["derivation"] === "constraint"
        ? `profiles/${pkg.id}/${String(sd["id"])}.json`
        : `types/${String(sd["type"])}.json`;
    if (urls.has(url) || files.has(file)) {
      issues.push({
        severity: "error",
        code: "DEFINITION_DUPLICATE",
        message: `${url} (${file}) is defined twice`,
        subject: url,
      });
      continue;
    }
    urls.add(url);
    const document = typeDocument(candidate, primitives);
    const text = JSON.stringify(document);
    files.set(file, text);
    entries.push({
      url,
      name: document.name,
      type: document.type,
      kind: document.kind,
      abstract: document.abstract,
      ...(document.derivation === undefined ? {} : { derivation: document.derivation }),
      ...(document.baseDefinition === undefined ? {} : { baseDefinition: document.baseDefinition }),
      package: `${pkg.id}#${pkg.version}`,
      file,
      sha256: sha256Hex(text),
      size: utf8Length(text),
    });
  }
  if (issues.some((i) => i.severity === "error")) return { ok: false, issues };

  entries.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const manifest: IndexManifest = {
    indexFormat: INDEX_FORMAT_VERSION,
    fhirVersion,
    packages: ordered.map((p) => ({ id: p.id, version: p.version })),
    entries,
  };
  return { ok: true, value: { manifest, manifestText: JSON.stringify(manifest), files }, issues };
}

/** The StructureDefinitions the index keeps, in package order then resource order. */
function collect(packages: readonly PackageContents[], issues: IndexIssue[]): Candidate[] {
  const kept: Candidate[] = [];
  for (const p of packages) {
    const pkg = { id: p.id, version: p.version };
    for (const resource of p.resources) {
      if (!isObject(resource) || resource["resourceType"] !== "StructureDefinition") continue;
      const kind = str(resource["kind"]);
      if (kind === "logical") continue;
      if (resource["derivation"] === "constraint" && resource["type"] === "Extension") continue;
      const url = str(resource["url"]) ?? `${p.id}#${p.version}: StructureDefinition`;
      if (
        kind === undefined ||
        !KINDS.includes(kind) ||
        str(resource["url"]) === undefined ||
        str(resource["id"]) === undefined ||
        str(resource["name"]) === undefined ||
        str(resource["type"]) === undefined
      ) {
        issues.push({
          severity: "warning",
          code: "DEFINITION_MALFORMED",
          message: `${url} is left out: it lacks url, id, name, type or a supported kind`,
          subject: url,
        });
        continue;
      }
      const snapshot = resource["snapshot"];
      const elements = isObject(snapshot) ? snapshot["element"] : undefined;
      if (!Array.isArray(elements) || elements.length === 0 || !elements.every(isObject)) {
        issues.push({
          severity: "warning",
          code: "DEFINITION_WITHOUT_SNAPSHOT",
          message: `${url} is left out: it has no snapshot`,
          subject: url,
        });
        continue;
      }
      kept.push({ sd: resource, snapshot: elements, pkg, kind: kind as DefinitionKind });
    }
  }
  return kept;
}

function typeDocument(candidate: Candidate, primitives: ReadonlySet<string>): TypeDocument {
  const { sd, snapshot, kind } = candidate;
  const derivation = sd["derivation"];
  const base = str(sd["baseDefinition"]);
  return {
    indexFormat: INDEX_FORMAT_VERSION,
    url: String(sd["url"]),
    name: String(sd["name"]),
    type: String(sd["type"]),
    kind,
    abstract: sd["abstract"] === true,
    ...(derivation === "specialization" || derivation === "constraint" ? { derivation } : {}),
    ...(base === undefined ? {} : { baseDefinition: base }),
    elements: snapshot.map((e) => indexElement(e, primitives)),
  };
}

function indexElement(e: Json, primitives: ReadonlySet<string>): IndexElement {
  const path = str(e["path"]) ?? "";
  const id = str(e["id"]) ?? path;
  const types = Array.isArray(e["type"]) ? e["type"].filter(isObject).map(elementType) : [];
  const binding = isObject(e["binding"]) ? elementBinding(e["binding"]) : undefined;
  const slicing = isObject(e["slicing"]) ? elementSlicing(e["slicing"]) : undefined;
  const fixed = elementValue(e, "fixed", primitives);
  const pattern = elementValue(e, "pattern", primitives);
  const contentReference = str(e["contentReference"]);
  const short = str(e["short"]);
  const sliceName = str(e["sliceName"]);
  return {
    id,
    ...(path === id ? {} : { path }),
    min: typeof e["min"] === "number" ? e["min"] : 0,
    max: str(e["max"]) ?? "*",
    ...(types.length === 0 ? {} : { type: types }),
    ...(contentReference === undefined ? {} : { contentReference }),
    ...(short === undefined ? {} : { short }),
    ...(binding === undefined ? {} : { binding }),
    ...(sliceName === undefined ? {} : { sliceName }),
    ...(slicing === undefined ? {} : { slicing }),
    ...(fixed === undefined ? {} : { fixed }),
    ...(pattern === undefined ? {} : { pattern }),
    ...(e["isModifier"] === true ? { isModifier: true as const } : {}),
    ...(e["mustSupport"] === true ? { mustSupport: true as const } : {}),
  };
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((v): v is string => typeof v === "string");
  return list.length === 0 ? undefined : list;
}

function elementType(t: Json): ElementType {
  const profile = stringList(t["profile"]);
  const targetProfile = stringList(t["targetProfile"]);
  return {
    code: str(t["code"]) ?? "",
    ...(profile === undefined ? {} : { profile }),
    ...(targetProfile === undefined ? {} : { targetProfile }),
  };
}

const STRENGTHS: readonly string[] = ["required", "extensible", "preferred", "example"];

function elementBinding(b: Json): ElementBinding | undefined {
  const strength = str(b["strength"]);
  if (strength === undefined || !STRENGTHS.includes(strength)) return undefined;
  const valueSet = str(b["valueSet"]);
  return {
    strength: strength as ElementBinding["strength"],
    ...(valueSet === undefined ? {} : { valueSet }),
  };
}

function elementSlicing(s: Json): ElementSlicing | undefined {
  const rules = str(s["rules"]);
  if (rules !== "closed" && rules !== "open" && rules !== "openAtEnd") return undefined;
  const discriminator = Array.isArray(s["discriminator"])
    ? s["discriminator"]
        .filter(isObject)
        .map((d) => ({ type: str(d["type"]) ?? "", path: str(d["path"]) ?? "" }))
    : [];
  return {
    ...(discriminator.length === 0 ? {} : { discriminator }),
    rules,
    ...(typeof s["ordered"] === "boolean" ? { ordered: s["ordered"] } : {}),
  };
}

/**
 * The `fixed[x]` or `pattern[x]` value of an element. The type comes from the key's suffix:
 * a primitive type starts lower case (`fixedUri` → `uri`), a complex one keeps its name
 * (`patternCodeableConcept` → `CodeableConcept`).
 */
function elementValue(
  e: Json,
  prefix: "fixed" | "pattern",
  primitives: ReadonlySet<string>,
): ElementValue | undefined {
  const key = Object.keys(e).find((k) => k.startsWith(prefix) && k.length > prefix.length);
  if (key === undefined) return undefined;
  const suffix = key.slice(prefix.length);
  const lower = suffix.charAt(0).toLowerCase() + suffix.slice(1);
  return { type: primitives.has(lower) ? lower : suffix, value: e[key] };
}
