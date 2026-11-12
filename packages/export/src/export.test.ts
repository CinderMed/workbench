import { isValid, parseProject, validateProjectSchema, type ProjectFile } from "@cindermed/model";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import metastraProject from "../../../fixtures/fml-examples/metastra/project.json?raw";
import motuProject from "../../../fixtures/fml-examples/motu/project.json?raw";
import { ExportCode, cleanProject, exportPackage, loadOrder, packageVersion } from "./index.js";

const options = {
  createdAt: "2026-11-12T10:20:30Z",
  generator: { name: "cindermed", version: "test" },
};

function exported(text: string, extra: Partial<Parameters<typeof exportPackage>[1]> = {}) {
  const result = exportPackage(text, { ...options, ...extra });
  if (!result.ok) throw new Error(JSON.stringify(result.results));
  return result;
}

function project(text: string): ProjectFile {
  const parsed = parseProject(text).project;
  if (parsed === undefined) throw new Error("fixture project is not valid");
  return parsed;
}

/** Fields of the central directory of a zip: per entry, "made by", time, date and attributes. */
function centralDirectory(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = zip.length - 22;
  while (view.getUint32(end, true) !== 0x06054b50) end--;
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const nameLength = view.getUint16(offset + 28, true);
    const extra = view.getUint16(offset + 30, true);
    const comment = view.getUint16(offset + 32, true);
    entries.push({
      name: strFromU8(zip.subarray(offset + 46, offset + 46 + nameLength)),
      madeBy: view.getUint16(offset + 4, true) >> 8,
      time: view.getUint16(offset + 12, true),
      date: view.getUint16(offset + 14, true),
      attrs: view.getUint32(offset + 38, true),
      extra,
      comment,
    });
    offset += 46 + nameLength + extra + comment;
  }
  return entries;
}

describe("deterministic zip", () => {
  it("gives identical bytes when the same project is exported twice", () => {
    expect(exported(motuProject).zip).toEqual(exported(motuProject).zip);
  });

  it("fixes the order, time, system and attributes of every entry", () => {
    const entries = centralDirectory(exported(motuProject).zip);
    expect(entries.map((e) => e.name)).toEqual([...entries.map((e) => e.name)].sort());
    // 2026-11-12 10:20:30 in DOS format, from the UTC fields of createdAt.
    const time = (10 << 11) | (20 << 5) | (30 >> 1);
    const date = ((2026 - 1980) << 9) | (11 << 5) | 12;
    for (const entry of entries) {
      expect(entry).toMatchObject({
        madeBy: 3,
        time,
        date,
        attrs: (0o100644 << 16) >>> 0,
        extra: 0,
        comment: 0,
      });
    }
  });

  it("holds exactly the package files", () => {
    const result = exported(motuProject);
    const unzipped = unzipSync(result.zip);
    expect(Object.keys(unzipped).sort()).toEqual([...result.files.keys()].sort());
    for (const [path, bytes] of result.files) expect(unzipped[path]).toEqual(bytes);
  });

  it("changes when createdAt changes", () => {
    expect(exported(motuProject, { createdAt: "2026-11-13T00:00:00Z" }).zip).not.toEqual(
      exported(motuProject).zip,
    );
  });
});

describe("package version", () => {
  it("uses the given version, else a dev version from the project text", () => {
    expect(exported(motuProject, { packageVersion: "1.2.3" }).manifest.package.version).toBe(
      "1.2.3",
    );
    const dev = exported(motuProject).manifest.package.version;
    expect(dev).toMatch(/^0\.0\.0-dev\.[0-9a-f]{12}$/);
    expect(dev).toBe(packageVersion(motuProject));
    expect(packageVersion(metastraProject)).not.toBe(dev);
  });

  it("gives the logical models and ConceptMaps the package version (#83)", () => {
    const result = exported(motuProject, { packageVersion: "2.0.0" });
    const versions = [...result.files]
      .filter(([path]) => /^(StructureDefinition|ConceptMap)-/.test(path))
      .map(([, bytes]) => (JSON.parse(strFromU8(bytes)) as { version: string }).version);
    expect(new Set(versions)).toEqual(new Set(["2.0.0"]));
  });
});

describe("cleaned project copy", () => {
  /** Metastra with every user and collaboration field the schema allows. */
  function withCollaboration(): ProjectFile {
    const file = project(metastraProject);
    let n = 0;
    const review = () => ({
      status: "approved" as const,
      comments: [
        {
          id: `cmt_${String(++n).padStart(4, "0")}`,
          author: "user-42",
          createdAt: "2026-11-12T00:00:00Z",
          text: "checked",
        },
      ],
    });
    const provenance = { kind: "ai" as const, detail: "model", acceptedBy: "user-7" };
    file.project.createdAt = "2026-11-01T00:00:00Z";
    file.project.updatedAt = "2026-11-02T00:00:00Z";
    file.extensions = { conversion: { secret: "x" } };
    for (const item of [
      ...file.sources.flatMap((s) => s.columns),
      ...file.instances,
      ...file.mappings,
      ...file.valueMaps,
    ]) {
      Object.assign(item, { review: review(), provenance });
    }
    return file;
  }

  const forbidden = [
    "review",
    "provenance",
    "verification",
    "comments",
    "author",
    "acceptedBy",
    "extensions",
  ];
  const keys = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.flatMap(keys)
      : value !== null && typeof value === "object"
        ? Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)])
        : [];

  it("keeps no comment, user or collaboration field, and stays a valid project", () => {
    const original = withCollaboration();
    expect(keys(original)).toEqual(expect.arrayContaining(forbidden));
    const cleaned = cleanProject(original);
    expect(keys(cleaned).filter((k) => forbidden.includes(k))).toEqual([]);
    expect(Object.keys(cleaned.project)).not.toContain("createdAt");
    expect(Object.keys(cleaned.project)).not.toContain("updatedAt");
    expect(isValid(validateProjectSchema(cleaned))).toBe(true);
    expect(keys(original)).toContain("review"); // the input is not changed
  });

  it("keeps descriptions and gives the same artifacts as the full project", () => {
    const original = withCollaboration();
    const full = exported(JSON.stringify(original), { packageVersion: "0.1.0" });
    const packaged = strFromU8(full.files.get("project.json") ?? new Uint8Array());
    expect(packaged).toContain("Pain intensity classes used in FirstOverview and LastOverview.");
    expect(packaged).not.toContain("user-42");
    expect(packaged).not.toContain("user-7");
    const again = exported(packaged, { packageVersion: "0.1.0" });
    for (const [path, bytes] of full.files) {
      if (path !== "project.json" && path !== "manifest.json")
        expect(again.files.get(path), path).toEqual(bytes);
    }
  });
});

describe("blocking results and warnings", () => {
  it("blocks on an integrity error and returns quality warnings otherwise", () => {
    const broken = project(motuProject);
    const [row] = broken.mappings;
    if (row === undefined) throw new Error("fixture changed");
    broken.mappings.push({ ...row, id: "map_dup" }); // same row code: DUPLICATE_ROW_CODE
    const result = exportPackage(JSON.stringify(broken), options);
    expect(result.ok).toBe(false);

    const warned = project(motuProject);
    warned.sources[0].columns.push({ id: "col_extra", name: "extra", dataType: "categorical" });
    const ok = exportPackage(JSON.stringify(warned), options);
    expect(ok.ok && ok.warnings.map((w) => w.code)).toEqual(["ALLOWED_VALUES_MISSING"]);
  });

  it("blocks on generator errors and on a cycle between tables", () => {
    const unsupported = project(motuProject);
    const [first] = unsupported.mappings;
    if (first === undefined) throw new Error("fixture changed");
    first.transform = { kind: "expression", language: "fml", expression: "x" };
    const result = exportPackage(JSON.stringify(unsupported), options);
    expect(result.ok ? [] : result.results.map((r) => r.code)).toContain("TRANSFORM_UNSUPPORTED");

    // MotuPatient also references Encounter[0] of HospitalStay, which references MotuPatient.
    const cyclic = project(motuProject);
    const encounter = cyclic.instances.find((i) => i.id === "ins_encounter0");
    if (encounter === undefined) throw new Error("fixture changed");
    encounter.idRule = { parts: [{ literal: "enc" }, { columnId: "col_s_id" }] };
    cyclic.sourceRelations?.push({
      id: "rel_back",
      from: { sourceId: "src_patient", columnIds: ["col_p_id"] },
      to: { sourceId: "src_stay", columnIds: ["col_s_id"] },
    });
    cyclic.mappings.push({
      id: "map_back",
      code: "R-099",
      instanceId: "ins_patient0",
      path: "link",
      transform: { kind: "reference", targetInstanceId: "ins_encounter0", via: "rel_back" },
    });
    expect(loadOrder(cyclic).cycle).toEqual(["Fall", "HospitalStay", "MotuPatient"]);
    const blocked = exportPackage(JSON.stringify(cyclic), options);
    expect(blocked.ok ? [] : blocked.results.map((r) => r.code)).toContain(ExportCode.TABLE_CYCLE);
  });
});
