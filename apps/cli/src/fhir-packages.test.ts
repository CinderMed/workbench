import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { c as create } from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type PackageOptions,
  PackageError,
  loadDefinitions,
  packageFolder,
  readPackage,
  writeIndex,
} from "./fhir-packages.js";

const FHIR = "http://hl7.org/fhir/StructureDefinition/";

function sd(name: string, kind: string, extra: Record<string, unknown> = {}) {
  return {
    resourceType: "StructureDefinition",
    id: name,
    url: `${FHIR}${name}`,
    name,
    type: name,
    kind,
    abstract: false,
    derivation: "specialization",
    snapshot: { element: [{ id: name, path: name, min: 0, max: "*" }] },
    ...extra,
  };
}

let work: string;
let cache: string;
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "cindermed-fhir-packages-"));
  cache = join(work, "cache");
  await mkdir(cache);
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

/** Files of a package folder: `package.json`, `.index.json` and the resources. */
function packageFiles(
  id: string,
  version: string,
  resources: Record<string, unknown>,
  options: { dependencies?: Record<string, string>; index?: boolean; fhirVersions?: string[] } = {},
): Record<string, string> {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: id,
      version,
      fhirVersions: options.fhirVersions ?? ["4.0.1"],
      ...(options.dependencies === undefined ? {} : { dependencies: options.dependencies }),
    }),
  };
  for (const [file, resource] of Object.entries(resources)) files[file] = JSON.stringify(resource);
  if (options.index !== false)
    files[".index.json"] = JSON.stringify({
      "index-version": 2,
      files: Object.entries(resources).map(([filename, r]) => ({
        filename,
        resourceType: (r as { resourceType?: string }).resourceType,
      })),
    });
  return files;
}

async function writeFiles(dir: string, files: Record<string, string>) {
  await mkdir(dir, { recursive: true });
  for (const [file, text] of Object.entries(files)) await writeFile(join(dir, file), text);
}

/** Puts a package straight into the cache, as if downloaded before. */
async function cached(id: string, version: string, files: Record<string, string>) {
  await writeFiles(join(cache, `${id}#${version}`, "package"), files);
}

/** A package tarball (package/ plus an other/ folder that must not be extracted). */
async function tarball(files: Record<string, string>): Promise<Uint8Array> {
  const source = join(work, `src-${String(Math.random()).slice(2)}`);
  await writeFiles(join(source, "package"), files);
  await writeFiles(join(source, "other"), { "icon.txt": "not a resource" });
  const file = join(work, "package.tgz");
  await create({ gzip: true, cwd: source, file, portable: true }, ["package", "other"]);
  return new Uint8Array(await readFile(file));
}

/** A registry serving these tarballs, with the SHA-1 of each in the metadata. */
function registry(packages: Record<string, Uint8Array>, overrides: Record<string, string> = {}) {
  const asked: string[] = [];
  const fetch: typeof globalThis.fetch = (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    asked.push(url);
    const path = url.replace("https://packages.fhir.org/", "");
    const tgz = packages[decodeURIComponent(path)];
    if (tgz !== undefined)
      return Promise.resolve(
        new Response(tgz, { headers: { "content-length": String(tgz.length) } }),
      );
    const [id] = path.split("/");
    const versions: Record<string, { dist: { shasum: string } }> = {};
    for (const [key, bytes] of Object.entries(packages)) {
      const [pid, version] = key.split("/");
      if (pid !== id || version === undefined) continue;
      versions[version] = {
        dist: { shasum: overrides[key] ?? createHash("sha1").update(bytes).digest("hex") },
      };
    }
    if (Object.keys(versions).length === 0)
      return Promise.resolve(new Response("", { status: 404 }));
    return Promise.resolve(Response.json({ versions }));
  };
  return { asked, fetch };
}

const core = () =>
  packageFiles("hl7.fhir.r4.core", "4.0.1", {
    "StructureDefinition-Patient.json": sd("Patient", "resource"),
    "StructureDefinition-string.json": sd("string", "primitive-type"),
    "ValueSet-x.json": { resourceType: "ValueSet" },
  });

describe("FHIR package cache", () => {
  it("uses a package already in the cache, without the network", async () => {
    await cached("hl7.fhir.r4.core", "4.0.1", core());
    const { asked, fetch } = registry({});
    const folder = await packageFolder(
      { id: "hl7.fhir.r4.core", version: "4.0.1" },
      { cacheDir: cache, fetch },
    );
    expect(folder).toBe(join(cache, "hl7.fhir.r4.core#4.0.1", "package"));
    expect(asked).toEqual([]);
  });

  it("downloads a missing package, checks it and extracts only package/", async () => {
    const tgz = await tarball(
      packageFiles("example.ig", "1.0.0", { "StructureDefinition-a.json": sd("a", "resource") }),
    );
    const { asked, fetch } = registry({ "example.ig/1.0.0": tgz });
    const folder = await packageFolder(
      { id: "example.ig", version: "1.0.0" },
      { cacheDir: cache, fetch },
    );
    expect(asked).toEqual([
      "https://packages.fhir.org/example.ig",
      "https://packages.fhir.org/example.ig/1.0.0",
    ]);
    expect((await readdir(folder)).sort()).toEqual([
      ".index.json",
      "StructureDefinition-a.json",
      "package.json",
    ]);
    // No temporary folder and no other/ folder left behind.
    expect(await readdir(cache)).toEqual(["example.ig#1.0.0"]);
    expect(await readdir(join(cache, "example.ig#1.0.0"))).toEqual(["package"]);
  });

  it("refuses a package whose checksum does not match, and leaves the cache clean", async () => {
    const tgz = await tarball(packageFiles("example.ig", "1.0.0", {}));
    const { fetch } = registry({ "example.ig/1.0.0": tgz }, { "example.ig/1.0.0": "0".repeat(40) });
    await expect(
      packageFolder({ id: "example.ig", version: "1.0.0" }, { cacheDir: cache, fetch }),
    ).rejects.toThrow(
      /example\.ig#1\.0\.0: the downloaded package does not match its SHA1 \([0-9a-f]{40}, expected 0{40}\)/,
    );
    expect(await readdir(cache)).toEqual([]);
  });

  it("checks a core package against its pinned SHA-256", async () => {
    const tgz = await tarball(core());
    const { fetch } = registry({ "hl7.fhir.r4.core/4.0.1": tgz });
    await expect(
      packageFolder({ id: "hl7.fhir.r4.core", version: "4.0.1" }, { cacheDir: cache, fetch }),
    ).rejects.toThrow(/does not match its SHA256 \(.*expected ebd7731df7d36b5b/);
  });

  it("reports a missing package when downloads are off, and registry failures", async () => {
    await expect(
      packageFolder({ id: "example.ig", version: "1.0.0" }, { cacheDir: cache, offline: true }),
    ).rejects.toThrow(
      `example.ig#1.0.0 is not in the FHIR package cache (${cache}) and downloads are off`,
    );
    const { fetch } = registry({});
    await expect(
      packageFolder({ id: "nothing", version: "1.0.0" }, { cacheDir: cache, fetch }),
    ).rejects.toThrow("nothing#1.0.0: https://packages.fhir.org/nothing answered 404");
    const offline = (() =>
      Promise.reject(new Error("getaddrinfo ENOTFOUND"))) as typeof globalThis.fetch;
    await expect(
      packageFolder({ id: "example.ig", version: "1.0.0" }, { cacheDir: cache, fetch: offline }),
    ).rejects.toThrow(
      "example.ig#1.0.0: https://packages.fhir.org/example.ig could not be reached (getaddrinfo ENOTFOUND)",
    );
  });

  it("refuses a version the registry gives no checksum for, and a tarball without package.json", async () => {
    const empty = await tarball({ "a.json": "{}" });
    const { fetch } = registry({ "example.ig/1.0.0": empty }, { "example.ig/1.0.0": "none" });
    await expect(
      packageFolder({ id: "example.ig", version: "1.0.0" }, { cacheDir: cache, fetch }),
    ).rejects.toThrow("example.ig#1.0.0: the registry gives no checksum for this version");
    const good = registry({ "example.ig/1.0.0": empty });
    await expect(
      packageFolder({ id: "example.ig", version: "1.0.0" }, { cacheDir: cache, fetch: good.fetch }),
    ).rejects.toThrow("the tarball has no package/package.json");
    expect(await readdir(cache)).toEqual([]);
  });
});

describe("readPackage", () => {
  it("reads only the StructureDefinitions listed in .index.json", async () => {
    const files = core();
    files["broken.json"] = "not json, and not listed";
    await cached("hl7.fhir.r4.core", "4.0.1", files);
    const read = await readPackage(
      { id: "hl7.fhir.r4.core", version: "4.0.1" },
      { cacheDir: cache, offline: true },
    );
    expect(read.fhirVersions).toEqual(["4.0.1"]);
    expect(read.dependencies).toEqual([]);
    expect(read.resources.map((r) => (r as { id: string }).id)).toEqual(["Patient", "string"]);
  });

  it("reads every JSON file without .index.json, and the old fhir-version-list", async () => {
    const files = packageFiles(
      "old.ig",
      "0.1.0",
      { "a.json": sd("a", "resource"), "b.json": { resourceType: "ValueSet" } },
      { index: false },
    );
    files["package.json"] = JSON.stringify({
      name: "old.ig",
      version: "0.1.0",
      "fhir-version-list": ["4.0.1"],
      dependencies: { "hl7.fhir.r4.core": "4.0.1" },
    });
    await cached("old.ig", "0.1.0", files);
    const read = await readPackage(
      { id: "old.ig", version: "0.1.0" },
      { cacheDir: cache, offline: true },
    );
    expect(read.fhirVersions).toEqual(["4.0.1"]);
    expect(read.dependencies).toEqual([{ id: "hl7.fhir.r4.core", version: "4.0.1" }]);
    expect(read.resources).toHaveLength(2);
  });

  it("names the file it cannot read", async () => {
    const files = core();
    files["StructureDefinition-Patient.json"] = "{";
    await cached("hl7.fhir.r4.core", "4.0.1", files);
    await expect(
      readPackage({ id: "hl7.fhir.r4.core", version: "4.0.1" }, { cacheDir: cache, offline: true }),
    ).rejects.toThrow(
      /hl7\.fhir\.r4\.core#4\.0\.1: StructureDefinition-Patient\.json could not be read/,
    );
  });
});

describe("loadDefinitions", () => {
  it("builds the index of the core package, the packages given and their dependencies", async () => {
    await cached("hl7.fhir.r4.core", "4.0.1", core());
    await cached(
      "example.ig",
      "1.0.0",
      packageFiles(
        "example.ig",
        "1.0.0",
        { "a.json": sd("my-patient", "resource", { type: "Patient", derivation: "constraint" }) },
        { dependencies: { "hl7.fhir.r4.core": "4.0.1", "example.dep": "2.0.0" } },
      ),
    );
    await cached(
      "example.dep",
      "2.0.0",
      packageFiles("example.dep", "2.0.0", {
        "b.json": sd("NoSnapshot", "resource", { snapshot: undefined }),
      }),
    );
    const loaded = await loadDefinitions("4.0.1", [{ id: "example.ig", version: "1.0.0" }], {
      cacheDir: cache,
      offline: true,
    });
    expect(loaded.index.manifest.packages).toEqual([
      { id: "hl7.fhir.r4.core", version: "4.0.1" },
      { id: "example.dep", version: "2.0.0" },
      { id: "example.ig", version: "1.0.0" },
    ]);
    expect(loaded.definitions.resourceTypes()).toEqual(["Patient"]);
    expect(loaded.definitions.isLoaded(`${FHIR}my-patient`)).toBe(true);
    expect(loaded.issues.map((i) => i.code)).toEqual(["DEFINITION_WITHOUT_SNAPSHOT"]);

    const out = join(work, "index");
    await writeIndex(loaded.index, out);
    expect(await readFile(join(out, "index.json"), "utf8")).toBe(loaded.index.manifestText);
    expect(await readFile(join(out, "profiles", "example.ig", "my-patient.json"), "utf8")).toBe(
      loaded.index.files.get("profiles/example.ig/my-patient.json"),
    );
  });

  it("refuses an unsupported FHIR version, conflicting versions and packages for another FHIR version", async () => {
    await expect(loadDefinitions("3.0.2", [], { cacheDir: cache })).rejects.toThrow(PackageError);
    await cached("hl7.fhir.r4.core", "4.0.1", core());
    await cached(
      "a.ig",
      "1.0.0",
      packageFiles("a.ig", "1.0.0", {}, { dependencies: { "b.ig": "1.0.0" } }),
    );
    await cached("b.ig", "1.0.0", packageFiles("b.ig", "1.0.0", {}));
    await cached("b.ig", "2.0.0", packageFiles("b.ig", "2.0.0", {}));
    await expect(
      loadDefinitions(
        "4.0.1",
        [
          { id: "a.ig", version: "1.0.0" },
          { id: "b.ig", version: "2.0.0" },
        ],
        { cacheDir: cache, offline: true },
      ),
    ).rejects.toThrow("b.ig is needed in two versions: 2.0.0 and 1.0.0");
    await cached("r5.ig", "1.0.0", packageFiles("r5.ig", "1.0.0", {}, { fhirVersions: ["5.0.0"] }));
    await expect(
      loadDefinitions("4.0.1", [{ id: "r5.ig", version: "1.0.0" }], {
        cacheDir: cache,
        offline: true,
      }),
    ).rejects.toThrow("package r5.ig#1.0.0 is for FHIR 5.0.0, not 4.0.1");
  });
});

/**
 * A gzipped tarball written header by header (ustar), for entries `tar.c` will not create:
 * devices, FIFOs, `..` and absolute paths. `type` is the ustar type flag.
 */
function rawTarball(entries: { path: string; type: string; data?: string }[]): Uint8Array {
  const blocks: Buffer[] = [];
  const field = (header: Buffer, offset: number, length: number, value: string) => {
    header.write(value.slice(0, length), offset, "latin1");
  };
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? "", "utf8");
    const header = Buffer.alloc(512);
    field(header, 0, 100, entry.path);
    field(header, 100, 8, "0000644\0");
    field(header, 108, 8, "0000000\0");
    field(header, 116, 8, "0000000\0");
    field(header, 124, 12, `${data.length.toString(8).padStart(11, "0")}\0`);
    field(header, 136, 12, "00000000000\0");
    field(header, 148, 8, "        ");
    field(header, 156, 1, entry.type);
    field(header, 257, 6, "ustar\0");
    field(header, 263, 2, "00");
    let sum = 0;
    for (const byte of header) sum += byte;
    field(header, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return new Uint8Array(gzipSync(Buffer.concat(blocks)));
}

const ig = { id: "example.ig", version: "1.0.0" };
const PACKAGE_JSON = JSON.stringify({
  name: "example.ig",
  version: "1.0.0",
  fhirVersions: ["4.0.1"],
});

describe("package tarballs are checked before extraction", () => {
  async function refused(
    tgz: Uint8Array,
    message: string | RegExp,
    options: Partial<PackageOptions> = {},
  ) {
    const { fetch } = registry({ "example.ig/1.0.0": tgz });
    await expect(packageFolder(ig, { cacheDir: cache, fetch, ...options })).rejects.toThrow(
      message,
    );
    // Nothing is extracted: no package, no temporary folder.
    expect(await readdir(cache)).toEqual([]);
  }

  it("refuses symbolic links", async () => {
    const source = join(work, "with-symlink");
    await writeFiles(join(source, "package"), { "package.json": PACKAGE_JSON });
    await symlink("/etc/passwd", join(source, "package", "passwd.json"));
    const file = join(work, "symlink.tgz");
    await create({ gzip: true, cwd: source, file, portable: true }, ["package"]);
    await refused(
      new Uint8Array(await readFile(file)),
      "example.ig#1.0.0: the tarball contains package/passwd.json, a SymbolicLink entry; only files and folders are allowed",
    );
  });

  it("refuses hard links", async () => {
    const source = join(work, "with-link");
    await writeFiles(join(source, "package"), { "package.json": PACKAGE_JSON, "a.json": "{}" });
    await link(join(source, "package", "a.json"), join(source, "package", "b.json"));
    const file = join(work, "link.tgz");
    await create({ gzip: true, cwd: source, file, portable: true }, ["package"]);
    await refused(
      new Uint8Array(await readFile(file)),
      /a Link entry; only files and folders are allowed/,
    );
  });

  it.each([
    ["a character device", "3", "CharacterDevice"],
    ["a block device", "4", "BlockDevice"],
    ["a FIFO", "6", "FIFO"],
  ])("refuses %s, even outside package/", async (_name, type, typeName) => {
    await refused(
      rawTarball([
        { path: "package/package.json", type: "0", data: PACKAGE_JSON },
        { path: "other/dev", type },
      ]),
      `example.ig#1.0.0: the tarball contains other/dev, a ${typeName} entry; only files and folders are allowed`,
    );
  });

  it.each(["package/../../escape.json", "/tmp/escape.json"])(
    "refuses the path %s",
    async (path) => {
      await refused(
        rawTarball([
          { path: "package/package.json", type: "0", data: PACKAGE_JSON },
          { path, type: "0", data: "{}" },
        ]),
        `example.ig#1.0.0: the tarball contains a path outside its folder (${path})`,
      );
    },
  );

  it("refuses a tarball larger than the extraction limit once extracted", async () => {
    await refused(
      rawTarball([
        { path: "package/package.json", type: "0", data: PACKAGE_JSON },
        { path: "package/big.json", type: "0", data: "x".repeat(4000) },
      ]),
      "example.ig#1.0.0: the tarball is larger than the extraction limit (0 MB) once extracted",
      { limits: { maxExtractedBytes: 2000 } },
    );
  });

  it("refuses a truncated tarball", async () => {
    const whole = rawTarball([
      { path: "package/package.json", type: "0", data: PACKAGE_JSON },
      { path: "package/a.json", type: "0", data: "y".repeat(3000) },
    ]);
    await refused(
      whole.slice(0, Math.floor(whole.length / 2)),
      /example\.ig#1\.0\.0: the tarball could not be read/,
    );
  });

  it("extracts a valid raw tarball", async () => {
    const { fetch } = registry({
      "example.ig/1.0.0": rawTarball([
        { path: "package/", type: "5" },
        { path: "package/package.json", type: "0", data: PACKAGE_JSON },
      ]),
    });
    const folder = await packageFolder(ig, { cacheDir: cache, fetch });
    expect(await readdir(folder)).toEqual(["package.json"]);
  });
});

describe("registry requests have size and time limits", () => {
  it("refuses a download larger than the limit, by Content-Length or while streaming", async () => {
    const tgz = await tarball(packageFiles("example.ig", "1.0.0", {}));
    const declared = registry({ "example.ig/1.0.0": tgz });
    const limits = { maxDownloadBytes: tgz.length - 1 };
    await expect(
      packageFolder(ig, { cacheDir: cache, fetch: declared.fetch, limits }),
    ).rejects.toThrow(
      "example.ig#1.0.0: https://packages.fhir.org/example.ig/1.0.0 is larger than the download limit (0 MB)",
    );
    // A server that sends no Content-Length: the body is counted as it streams.
    const streaming: typeof globalThis.fetch = async (input, init) => {
      const response = await declared.fetch(input, init);
      const body = new Uint8Array(await response.arrayBuffer());
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < body.length; i += 100) controller.enqueue(body.slice(i, i + 100));
          controller.close();
        },
      });
      return new Response(stream, { status: response.status });
    };
    await expect(packageFolder(ig, { cacheDir: cache, fetch: streaming, limits })).rejects.toThrow(
      "is larger than the download limit (0 MB)",
    );
    expect(await readdir(cache)).toEqual([]);
  });

  it("gives up on a registry that does not answer in time", async () => {
    const silent: typeof globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason instanceof Error ? init.signal.reason : new Error("aborted"));
        });
      });
    await expect(
      packageFolder(ig, { cacheDir: cache, fetch: silent, limits: { requestTimeoutMs: 50 } }),
    ).rejects.toThrow(
      "example.ig#1.0.0: https://packages.fhir.org/example.ig did not answer within 0.05 s",
    );
  });

  it("refuses registry metadata that is not JSON", async () => {
    const html: typeof globalThis.fetch = () => Promise.resolve(new Response("<html>"));
    await expect(packageFolder(ig, { cacheDir: cache, fetch: html })).rejects.toThrow(
      "example.ig#1.0.0: https://packages.fhir.org/example.ig did not answer with JSON",
    );
  });
});
