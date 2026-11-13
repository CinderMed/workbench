/**
 * FHIR packages on disk and from the registry (ADR-0013): the Node side of @cindermed/fhir-defs,
 * used by the CLI now and by the API later.
 *
 * Packages live in the FHIR package cache (`~/.fhir/packages/<id>#<version>/package/`), the
 * folder the HL7 validator and other FHIR tools share. A missing package is downloaded from
 * packages.fhir.org, checked (SHA-256 pinned for the core packages, the registry's SHA-1 for the
 * others), extracted to a temporary folder and then renamed into place, so the cache never holds
 * half a package.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  type BuiltIndex,
  FhirDefinitions,
  type IndexIssue,
  type PackageContents,
  type PackageRef,
  buildIndex,
  corePackage,
  findCorePackage,
} from "@cindermed/fhir-defs";
import { Parser, type ReadEntry, x as extract } from "tar";

export const DEFAULT_REGISTRY = "https://packages.fhir.org";

export interface PackageOptions {
  /** The FHIR package cache. Default: `~/.fhir/packages`. */
  readonly cacheDir?: string;
  /** Never download: a package missing from the cache is an error. */
  readonly offline?: boolean;
  /** The package registry. Default: packages.fhir.org. */
  readonly registry?: string;
  /** The fetch function (tests pass their own). Default: the global fetch. */
  readonly fetch?: typeof globalThis.fetch;
  /** Limits on downloads and extraction. Default: {@link DEFAULT_LIMITS}. */
  readonly limits?: Partial<PackageLimits>;
}

export interface PackageLimits {
  /** Largest package tarball (or registry answer) downloaded, in bytes. */
  readonly maxDownloadBytes: number;
  /** Largest total size of the entries of a tarball, in bytes: the extracted size at most. */
  readonly maxExtractedBytes: number;
  /** Time allowed for each registry request, headers and body, in milliseconds. */
  readonly requestTimeoutMs: number;
}

/**
 * Generous for the largest package the workbench uses: hl7.fhir.r5.core 5.0.0 is 17.1 MB
 * compressed and about 93 MB extracted (ADR-0013).
 */
export const DEFAULT_LIMITS: PackageLimits = {
  maxDownloadBytes: 100 * 1024 * 1024,
  maxExtractedBytes: 500 * 1024 * 1024,
  requestTimeoutMs: 120_000,
};

/** Entry types that may appear in a package tarball: regular files and directories only. */
const ALLOWED_ENTRY_TYPES: ReadonlySet<string> = new Set([
  "File",
  "OldFile",
  "ContiguousFile",
  "Directory",
]);

const megabytes = (bytes: number) => `${String(Math.round((bytes / 1024 / 1024) * 10) / 10)} MB`;

/** A package could not be found, downloaded, checked or read. */
export class PackageError extends Error {
  override readonly name = "PackageError";
}

export function defaultCacheDir(): string {
  return join(homedir(), ".fhir", "packages");
}

const label = (ref: PackageRef) => `${ref.id}#${ref.version}`;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The `package/` folder of a package in the cache, downloading the package if it is missing. */
export async function packageFolder(
  ref: PackageRef,
  options: PackageOptions = {},
): Promise<string> {
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  const folder = join(cacheDir, label(ref));
  if (await exists(join(folder, "package", "package.json"))) return join(folder, "package");
  if (options.offline === true)
    throw new PackageError(
      `${label(ref)} is not in the FHIR package cache (${cacheDir}) and downloads are off`,
    );
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const tarball = await download(ref, options, limits);
  await install(tarball, folder, cacheDir, limits, label(ref));
  return join(folder, "package");
}

async function download(
  ref: PackageRef,
  options: PackageOptions,
  limits: PackageLimits,
): Promise<Uint8Array> {
  const fetch = options.fetch ?? globalThis.fetch;
  const registry = (options.registry ?? DEFAULT_REGISTRY).replace(/\/+$/, "");
  const core = findCorePackage(ref.id, ref.version);
  // The expected digest: pinned for the core packages, from the registry for the others.
  const expected =
    core === undefined
      ? { algorithm: "sha1", digest: await registryShasum(ref, registry, fetch, limits) }
      : { algorithm: "sha256", digest: core.tarballSha256 };
  const url = `${registry}/${encodeURIComponent(ref.id)}/${encodeURIComponent(ref.version)}`;
  const bytes = await fetchBytes(fetch, url, label(ref), limits);
  const actual = createHash(expected.algorithm).update(bytes).digest("hex");
  if (actual !== expected.digest)
    throw new PackageError(
      `${label(ref)}: the downloaded package does not match its ${expected.algorithm.toUpperCase()} (${actual}, expected ${expected.digest})`,
    );
  return bytes;
}

async function registryShasum(
  ref: PackageRef,
  registry: string,
  fetch: typeof globalThis.fetch,
  limits: PackageLimits,
): Promise<string> {
  const url = `${registry}/${encodeURIComponent(ref.id)}`;
  const bytes = await fetchBytes(fetch, url, label(ref), limits);
  let metadata: unknown;
  try {
    metadata = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PackageError(`${label(ref)}: ${url} did not answer with JSON`);
  }
  const shasum = (metadata as { versions?: Record<string, { dist?: { shasum?: unknown } }> })
    .versions?.[ref.version]?.dist?.shasum;
  if (typeof shasum !== "string" || !/^[0-9a-f]{40}$/.test(shasum))
    throw new PackageError(`${label(ref)}: the registry gives no checksum for this version`);
  return shasum;
}

/**
 * Downloads a URL within the time and size limits. The timeout covers the whole request, body
 * included; the size is checked on `Content-Length` and again while the body streams in.
 */
async function fetchBytes(
  fetch: typeof globalThis.fetch,
  url: string,
  what: string,
  limits: PackageLimits,
): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(limits.requestTimeoutMs);
  const failed = (error: unknown): PackageError =>
    error instanceof PackageError
      ? error
      : signal.aborted
        ? new PackageError(
            `${what}: ${url} did not answer within ${String(limits.requestTimeoutMs / 1000)} s`,
          )
        : new PackageError(
            `${what}: ${url} could not be reached (${error instanceof Error ? error.message : String(error)})`,
          );
  const tooLarge = () =>
    new PackageError(
      `${what}: ${url} is larger than the download limit (${megabytes(limits.maxDownloadBytes)})`,
    );
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    throw failed(error);
  }
  if (!response.ok) throw new PackageError(`${what}: ${url} answered ${String(response.status)}`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > limits.maxDownloadBytes) {
    await response.body?.cancel();
    throw tooLarge();
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const reader = response.body?.getReader();
    for (;;) {
      if (reader === undefined) break;
      const read = await reader.read();
      if (read.done) break;
      const chunk: unknown = read.value;
      if (!(chunk instanceof Uint8Array)) throw new PackageError(`${what}: ${url} sent no bytes`);
      total += chunk.byteLength;
      if (total > limits.maxDownloadBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(chunk);
    }
  } catch (error) {
    throw failed(error);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Checks every entry of a tarball before anything is written: only regular files and
 * directories, relative paths without `..`, and a total size within the limit. The check stops
 * at the first problem, so an oversized archive is never decompressed in full.
 */
async function inspect(tarball: Uint8Array, what: string, limits: PackageLimits): Promise<void> {
  let total = 0;
  let problem: PackageError | undefined;
  const parser = new Parser({
    onReadEntry: (entry: ReadEntry) => {
      if (problem === undefined) {
        const path = entry.path;
        if (!ALLOWED_ENTRY_TYPES.has(entry.type))
          problem = new PackageError(
            `${what}: the tarball contains ${path}, a ${entry.type} entry; only files and folders are allowed`,
          );
        else if (
          path.startsWith("/") ||
          /^[A-Za-z]:/.test(path) ||
          path.split(/[\\/]/).includes("..")
        )
          problem = new PackageError(
            `${what}: the tarball contains a path outside its folder (${path})`,
          );
        else {
          total += entry.size;
          if (total > limits.maxExtractedBytes)
            problem = new PackageError(
              `${what}: the tarball is larger than the extraction limit (${megabytes(limits.maxExtractedBytes)}) once extracted`,
            );
        }
        if (problem !== undefined) parser.abort(problem);
      }
      entry.resume();
    },
  });
  await new Promise<void>((resolve, reject) => {
    parser.on("abort", () => {
      reject(problem ?? new PackageError(`${what}: the tarball could not be read`));
    });
    parser.on("error", (error: unknown) => {
      reject(
        problem ?? new PackageError(`${what}: the tarball could not be read (${String(error)})`),
      );
    });
    parser.on("end", () => {
      if (problem === undefined) resolve();
      else reject(problem);
    });
    parser.end(Buffer.from(tarball));
  });
}

/** Extracts the `package/` folder of a tarball into a temporary folder, then renames it into place. */
async function install(
  tarball: Uint8Array,
  folder: string,
  cacheDir: string,
  limits: PackageLimits,
  what: string,
): Promise<void> {
  await inspect(tarball, what, limits);
  const temporary = join(cacheDir, `.cindermed-${randomUUID()}`);
  await mkdir(temporary, { recursive: true });
  try {
    // inspect() has checked every entry; the filter repeats the type check as a second guard.
    await pipeline(
      Readable.from([tarball]),
      extract({
        cwd: temporary,
        filter: (path, entry) =>
          path.startsWith("package/") && "type" in entry && ALLOWED_ENTRY_TYPES.has(entry.type),
      }),
    );
    if (!(await exists(join(temporary, "package", "package.json"))))
      throw new PackageError(`${folder}: the tarball has no package/package.json`);
    // Another process may have installed it meanwhile: keep theirs.
    if (await exists(folder)) return;
    await rename(temporary, folder);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** A package read from the cache: its StructureDefinitions and its dependencies. */
export interface ReadPackage extends PackageContents {
  readonly resources: readonly unknown[];
  readonly dependencies: readonly PackageRef[];
}

/**
 * Reads a package's manifest and StructureDefinitions. With `.index.json` (FHIR package index),
 * only the StructureDefinition files are parsed; without it, every JSON file is.
 */
export async function readPackage(
  ref: PackageRef,
  options: PackageOptions = {},
): Promise<ReadPackage> {
  const folder = await packageFolder(ref, options);
  const json = async (file: string): Promise<unknown> => {
    try {
      return JSON.parse(await readFile(join(folder, file), "utf8")) as unknown;
    } catch (error) {
      throw new PackageError(
        `${label(ref)}: ${file} could not be read (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  };
  const manifest = (await json("package.json")) as {
    fhirVersions?: unknown;
    "fhir-version-list"?: unknown;
    dependencies?: unknown;
  };
  const versions = manifest.fhirVersions ?? manifest["fhir-version-list"];
  const fhirVersions = Array.isArray(versions) ? versions.filter((v) => typeof v === "string") : [];
  const dependencies = Object.entries(
    typeof manifest.dependencies === "object" && manifest.dependencies !== null
      ? manifest.dependencies
      : {},
  ).map(([id, version]) => ({ id, version: String(version) }));

  let files: string[];
  if (await exists(join(folder, ".index.json"))) {
    const index = (await json(".index.json")) as {
      files?: { filename?: unknown; resourceType?: unknown }[];
    };
    files = (index.files ?? [])
      .filter((f) => f.resourceType === "StructureDefinition" && typeof f.filename === "string")
      .map((f) => String(f.filename));
  } else {
    files = (await readdir(folder)).filter((f) => f.endsWith(".json") && f !== "package.json");
  }
  const resources: unknown[] = [];
  for (const file of files.sort()) resources.push(await json(file));
  return { id: ref.id, version: ref.version, fhirVersions, dependencies, resources };
}

export interface LoadedDefinitions {
  readonly index: BuiltIndex;
  /** Opened from the index, with every document loaded. */
  readonly definitions: FhirDefinitions;
  /** Warnings from the build (definitions left out). */
  readonly issues: readonly IndexIssue[];
}

/**
 * The definitions of a FHIR version and packages: the core package, the packages given and their
 * dependencies, read from the cache (downloaded when missing) and built into an index.
 */
export async function loadDefinitions(
  fhirVersion: string,
  packages: readonly PackageRef[],
  options: PackageOptions = {},
): Promise<LoadedDefinitions> {
  const core = corePackage(fhirVersion);
  if (core === undefined) throw new PackageError(`FHIR version ${fhirVersion} is not supported`);
  const read = new Map<string, ReadPackage>();
  const queue: PackageRef[] = [{ id: core.id, version: core.version }, ...packages];
  for (let ref = queue.shift(); ref !== undefined; ref = queue.shift()) {
    if (read.has(ref.id)) {
      const first = read.get(ref.id);
      if (first !== undefined && first.version !== ref.version)
        throw new PackageError(
          `${ref.id} is needed in two versions: ${first.version} and ${ref.version}`,
        );
      continue;
    }
    const contents = await readPackage(ref, options);
    read.set(ref.id, contents);
    queue.push(...contents.dependencies);
  }
  const built = buildIndex(fhirVersion, [...read.values()]);
  if (!built.ok) throw new PackageError(built.issues.map((i) => i.message).join("; "));
  const opened = FhirDefinitions.open(built.value.manifest);
  if (!opened.ok) throw new PackageError(opened.issues.map((i) => i.message).join("; "));
  for (const [file, text] of built.value.files) {
    const added = opened.value.add(file, text);
    if (!added.ok) throw new PackageError(added.issues.map((i) => i.message).join("; "));
  }
  return { index: built.value, definitions: opened.value, issues: built.issues };
}

/** Writes an index as the API serves it: `index.json` and one file per type or profile. */
export async function writeIndex(index: BuiltIndex, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.json"), index.manifestText);
  for (const [file, text] of index.files) {
    const path = join(dir, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
}
