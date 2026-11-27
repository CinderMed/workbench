/**
 * The export package (G7, ADR-0012): everything the conversion module needs to run a project,
 * checked against the official FML grammar (G10). No I/O (ADR-0001): project text in, files and a
 * deterministic zip out. Backend only, because it carries the grammar parser (ADR-0008).
 *
 * Pipeline: read and validate the project, FHIR level included when definitions are given (errors
 * block, warnings are returned) → for each table,
 * plan, logical model, normalization specification and map (generator errors block) → grammar
 * check of every printed map (errors, traced to the mapping row, block) → ConceptMaps → the
 * cleaned project copy → the three schemas → manifest with SHA-256 digests → zip.
 */
import {
  MANIFEST_FORMAT_VERSION,
  manifestSchema,
  normalizationSchema,
  parseProject,
  projectSchema,
  serializeProject,
  type ExportManifest,
  type ProjectFile,
  type ValidationResult,
} from "@cindermed/model";
import { type FhirDefinitions, findCorePackage, validateFhir } from "@cindermed/fhir-defs";
import { writtenPaths } from "./written-paths.js";
import {
  conceptMaps,
  generateMap,
  logicalModel,
  normalizationSpec,
  planTable,
  printMap,
  printMapWithLines,
  toStructureMap,
  type RuleName,
} from "@cindermed/fml";
import { GRAMMAR_COMMIT, checkGrammar } from "@cindermed/fml/grammar";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { cleanProject } from "./clean.js";
import { loadOrder } from "./load-order.js";
import { deterministicZip } from "./zip.js";
import { ZONE_RULES } from "./time-zones/zone-rules.js";

export const ExportCode = {
  /** Two tables depend on each other through `via` relations: no load order exists. */
  TABLE_CYCLE: "EXPORT_TABLE_CYCLE",
  /**
   * The SHA-256 of a FHIR package's tarball is unknown (a package in the cache without its
   * digest, loaded offline): the manifest must pin every package it was checked against (#146).
   */
  PACKAGE_DIGEST_MISSING: "EXPORT_PACKAGE_DIGEST_MISSING",
} as const;

/**
 * Every package the definitions were built from, with its tarball's SHA-256 (manifest 1.1.0,
 * #146): from the index, or pinned for a core package. A package without one is an error.
 */
function manifestPackages(
  definitions: FhirDefinitions,
  results: ValidationResult[],
): NonNullable<ExportManifest["packages"]> {
  return definitions.manifest.packages.map((p) => {
    const sha256 = p.tarballSha256 ?? findCorePackage(p.id, p.version)?.tarballSha256;
    if (sha256 === undefined)
      results.push({
        severity: "error",
        code: ExportCode.PACKAGE_DIGEST_MISSING,
        objectKind: "project",
        field: "project.packages",
        message: `The SHA-256 of the FHIR package ${p.id}#${p.version} is not known: it is in the package cache without its digest. Export once with downloads on, so the package is digested and the manifest can pin it.`,
      });
    return { name: p.id, version: p.version, ...(sha256 === undefined ? {} : { sha256 }) };
  });
}

export interface ExportOptions {
  /**
   * The FHIR definitions of the project's FHIR version, with every document the project needs
   * loaded (ADR-0013). Always needed (ADR-0023): the FHIR level of validation runs (D7) and its
   * errors block the export, and the generator writes element names and choice types from them.
   */
  readonly definitions: FhirDefinitions;
  /** ISO 8601 date-time of the package, also the timestamp of every zip entry. */
  readonly createdAt: string;
  /** Package version; absent = `0.0.0-dev.<first 12 hex of the SHA-256 of the project text>`. */
  readonly packageVersion?: string;
  /** Name and version of the tool that writes the package. */
  readonly generator: { readonly name: string; readonly version: string };
  /**
   * `$schema` written in the project copy, the normalization specifications and the manifest.
   * Default: the schemas included in the package (`schemas/…`).
   */
  readonly schemaRefs?: {
    readonly project?: string;
    readonly normalization?: string;
    readonly manifest?: string;
  };
}

export type ExportResult =
  | {
      readonly ok: true;
      readonly manifest: ExportManifest;
      /** Every file of the package, manifest included, by path. */
      readonly files: ReadonlyMap<string, Uint8Array>;
      readonly zip: Uint8Array;
      /** Quality warnings; they do not block the export. */
      readonly warnings: ValidationResult[];
    }
  | { readonly ok: false; readonly results: ValidationResult[] };

const GRAMMAR_SOURCE = "HL7/mapping-language-ig input/images/mapping.g4";
const json = (value: unknown): string => JSON.stringify(value, null, 2);

function mediaType(path: string): string {
  if (path.endsWith(".map")) return "text/fhir-mapping";
  const name = path.split("/").at(-1) ?? path;
  return /^(StructureMap|StructureDefinition|ConceptMap)-/.test(name)
    ? "application/fhir+json"
    : "application/json";
}

/** The package version: the given one, or a dev version derived from the project text. */
export function packageVersion(projectText: string, given?: string): string {
  return given ?? `0.0.0-dev.${bytesToHex(sha256(utf8ToBytes(projectText))).slice(0, 12)}`;
}

/** The mapping row whose code starts a rule name (`R-010` for `R-010-unit-1`), for diagnostics. */
function rowOf(project: ProjectFile, rule: RuleName): string | undefined {
  const rows = project.mappings.filter(
    (row) => rule === row.code || rule.startsWith(`${row.code}-`),
  );
  return rows.sort((a, b) => b.code.length - a.code.length)[0]?.id;
}

export function exportPackage(projectText: string, options: ExportOptions): ExportResult {
  const parsed = parseProject(projectText);
  const errors = parsed.results.filter((r) => r.severity === "error");
  if (parsed.project === undefined || errors.length > 0)
    return { ok: false, results: parsed.results };
  const project = parsed.project;
  // FHIR level (D7): its errors block the export like the other levels' errors.
  const fhir = validateFhir(project, options.definitions);
  if (fhir.some((r) => r.severity === "error"))
    return { ok: false, results: [...parsed.results, ...fhir] };
  const warnings = [...parsed.results, ...fhir].filter((r) => r.severity !== "error");
  const version = packageVersion(projectText, options.packageVersion);
  const refs = {
    project: options.schemaRefs?.project ?? "schemas/mapping-project.schema.json",
    normalization: options.schemaRefs?.normalization ?? "schemas/normalization.schema.json",
    manifest: options.schemaRefs?.manifest ?? "schemas/manifest.schema.json",
  };
  const results: ValidationResult[] = [];
  const order = loadOrder(project);
  if (order.levels === undefined) {
    results.push({
      severity: "error",
      code: ExportCode.TABLE_CYCLE,
      objectKind: "project",
      message: `The tables ${(order.cycle ?? []).join(", ")} cannot be ordered: their relations form a cycle, so no table can be loaded before the others.`,
    });
  }

  // Every path the generator writes, resolved with the definitions (ADR-0023).
  const written = writtenPaths(project, options.definitions);
  const text = new Map<string, string>();
  const tables: ExportManifest["tables"][number][] = [];
  for (const source of project.sources) {
    const planned = planTable(project, source.id);
    if (!planned.ok) {
      results.push(...planned.results);
      continue;
    }
    const plan = planned.value;
    const map = generateMap(project, plan, written);
    if (!map.ok) {
      results.push(...map.results);
      continue;
    }
    results.push(
      ...checkGrammar(printMapWithLines(map.value), {
        ownerOf: (rule) => {
          const id = rowOf(project, rule);
          return id === undefined ? undefined : { objectKind: "mapping", id };
        },
        fallback: { objectKind: "source", id: source.id },
      }),
    );
    const name = plan.name;
    const model = logicalModel(project, plan, { version });
    const files = {
      fml: `${name}.map`,
      json: `StructureMap-${name}.json`,
      model: `StructureDefinition-${model.name}.json`,
      normalization: `normalization-${name}.json`,
    };
    text.set(files.fml, printMap(map.value));
    text.set(
      files.json,
      json(
        toStructureMap(map.value, {
          fhirRelease: project.project.fhirVersion.startsWith("5") ? "R5" : "R4",
        }),
      ),
    );
    text.set(files.model, json(model));
    text.set(
      files.normalization,
      json(
        normalizationSpec(project, plan, {
          schemaRef: refs.normalization,
          zoneRules: ZONE_RULES,
        }),
      ),
    );
    tables.push({
      source: name,
      dependsOn: [...(order.dependsOn.get(name) ?? [])],
      structureMap: { url: map.value.url, fml: files.fml, json: files.json },
      logicalModel: { url: model.url, file: files.model },
      normalization: files.normalization,
      creates: project.instances
        .filter((i) => i.sourceId === source.id)
        .map(
          (i) =>
            `${i.resourceType}[${String(i.index)}]${i.label === undefined ? "" : ` · ${i.label}`}`,
        ),
    });
  }
  const packages = manifestPackages(options.definitions, results);
  if (results.length > 0) return { ok: false, results: [...results, ...warnings] };

  const release = project.project.fhirVersion.startsWith("5") ? "R5" : "R4";
  const maps = conceptMaps(project, { fhirRelease: release, version }).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  for (const map of maps) text.set(`ConceptMap-${map.id}.json`, json(map));

  const cleaned = { ...cleanProject(project), $schema: refs.project } as ProjectFile;
  const paths = [
    "project.json",
    ...tables.flatMap((t) => [
      t.structureMap.fml,
      t.structureMap.json,
      t.logicalModel.file,
      t.normalization,
    ]),
    ...maps.map((m) => `ConceptMap-${m.id}.json`),
    "schemas/mapping-project.schema.json",
    "schemas/normalization.schema.json",
    "schemas/manifest.schema.json",
  ];
  text.set("project.json", serializeProject(cleaned));
  text.set("schemas/mapping-project.schema.json", json(projectSchema));
  text.set("schemas/normalization.schema.json", json(normalizationSchema));
  text.set("schemas/manifest.schema.json", json(manifestSchema));

  const bytes = new Map([...text].map(([path, content]) => [path, utf8ToBytes(content)]));
  const output = project.project.output;
  const manifest: ExportManifest = {
    $schema: refs.manifest,
    formatVersion: MANIFEST_FORMAT_VERSION,
    package: {
      name: `${project.project.name.toLowerCase()}-mapping`,
      version,
      createdAt: options.createdAt,
      generator: { name: options.generator.name, version: options.generator.version },
    },
    project: {
      id: project.project.id,
      name: project.project.name,
      formatVersion: project.formatVersion,
      file: "project.json",
    },
    fhirVersion: project.project.fhirVersion,
    packages,
    output: {
      bundleType: output?.bundleType ?? "transaction",
      requestMethod: output?.requestMethod ?? "PUT",
      fullUrlBase: output?.fullUrlBase ?? project.project.canonicalBase,
    },
    loadOrder: (order.levels ?? []).map((level) => [...level] as [string, ...string[]]),
    tables: tables as ExportManifest["tables"],
    conceptMaps: maps.map((m) => ({ url: m.url, file: `ConceptMap-${m.id}.json` })),
    verification: {
      grammar: { source: GRAMMAR_SOURCE, commit: GRAMMAR_COMMIT, result: "passed" },
      compile: { result: "skipped" },
      checkedAt: options.createdAt,
    },
    files: paths.map((path) => ({
      path,
      sha256: bytesToHex(sha256(bytes.get(path) ?? new Uint8Array())),
      mediaType: mediaType(path),
    })),
  };
  bytes.set("manifest.json", utf8ToBytes(json(manifest)));
  return {
    ok: true,
    manifest,
    files: bytes,
    zip: deterministicZip(bytes, options.createdAt),
    warnings,
  };
}
