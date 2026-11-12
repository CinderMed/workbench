import { describe, expect, it } from "vitest";
import { buildIndex } from "./build-index.js";
import { r4Core } from "./test-support/synthetic-packages.js";
import { FhirDefinitions, indexId } from "./definitions.js";

function index() {
  const result = buildIndex("4.0.1", [r4Core()]);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function open() {
  const built = index();
  const opened = FhirDefinitions.open(JSON.parse(built.manifestText));
  if (!opened.ok) throw new Error(JSON.stringify(opened.issues));
  return { built, defs: opened.value };
}

/** A fetch function over the built files that records what it was asked. */
function fetcher(files: ReadonlyMap<string, string>) {
  const asked: string[] = [];
  const fetch = (file: string) => {
    asked.push(file);
    const text = files.get(file);
    return text === undefined ? Promise.reject(new Error("404")) : Promise.resolve(text);
  };
  return { asked, fetch };
}

describe("FhirDefinitions", () => {
  it("answers from the manifest alone: entries and resource types", () => {
    const { defs } = open();
    expect(defs.fhirVersion).toBe("4.0.1");
    expect(defs.resourceTypes()).toEqual(["Patient"]);
    expect(defs.entry("Patient")?.file).toBe("types/Patient.json");
    expect(defs.entry("http://hl7.org/fhir/StructureDefinition/Patient")?.name).toBe("Patient");
    // Profiles are found by URL, not by the type they constrain.
    expect(defs.entry("Quantity")).toBeUndefined();
    expect(defs.entry("http://hl7.org/fhir/StructureDefinition/SimpleQuantity")?.type).toBe(
      "Quantity",
    );
    expect(defs.isLoaded("Patient")).toBe(false);
  });

  it("loads only the documents asked for, once", async () => {
    const { built, defs } = open();
    const { asked, fetch } = fetcher(built.files);
    expect((await defs.load(["Patient", "HumanName"], fetch)).ok).toBe(true);
    expect((await defs.load(["Patient"], fetch)).ok).toBe(true);
    expect(asked.sort()).toEqual(["types/HumanName.json", "types/Patient.json"]);
    expect(defs.document("Patient")?.elements.map((e) => e.id)).toContain("Patient.name");
    expect(defs.isLoaded("string")).toBe(false);
  });

  it("reports unknown references and failed fetches, and keeps what loaded", async () => {
    const { built, defs } = open();
    const files = new Map(built.files);
    files.delete("types/HumanName.json");
    const result = await defs.load(["Patient", "HumanName", "Nothing"], fetcher(files).fetch);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code).sort()).toEqual([
      "INDEX_DOCUMENT_UNAVAILABLE",
      "INDEX_ENTRY_UNKNOWN",
    ]);
    expect(result.issues.find((i) => i.code === "INDEX_DOCUMENT_UNAVAILABLE")?.message).toBe(
      "types/HumanName.json could not be fetched: 404",
    );
    expect(defs.isLoaded("Patient")).toBe(true);
  });

  it("rejects a document that does not match the manifest", () => {
    const { built, defs } = open();
    const text = built.files.get("types/Patient.json") ?? "";
    expect(defs.add("types/Nothing.json", text).issues[0]?.code).toBe("INDEX_ENTRY_UNKNOWN");
    expect(defs.add("types/Patient.json", `${text} `).issues[0]?.code).toBe(
      "INDEX_DOCUMENT_DIGEST_MISMATCH",
    );
    expect(defs.isLoaded("Patient")).toBe(false);
    expect(defs.add("types/Patient.json", text).ok).toBe(true);
  });

  it("rejects a document with the right digest but the wrong content", () => {
    const { built } = open();
    // A manifest whose digests describe other texts: malformed JSON, another format, another URL.
    const cases: [string, string][] = [
      ["not json", "INDEX_DOCUMENT_MALFORMED"],
      [JSON.stringify({ indexFormat: "1.0.0", url: "x" }), "INDEX_DOCUMENT_MALFORMED"],
      [built.files.get("types/HumanName.json") ?? "", "INDEX_DOCUMENT_MALFORMED"],
    ];
    for (const [text, code] of cases) {
      const manifest = JSON.parse(built.manifestText) as {
        entries: { file: string; sha256: string }[];
      };
      const patient = manifest.entries.find((e) => e.file === "types/Patient.json");
      if (patient === undefined) throw new Error("no Patient");
      patient.sha256 = indexId(text);
      const opened = FhirDefinitions.open(manifest);
      if (!opened.ok) throw new Error("not opened");
      expect(opened.value.add("types/Patient.json", text).issues[0]?.code, text).toBe(code);
    }
  });

  it("opens only manifests of a supported format", () => {
    const { built } = open();
    const manifest = JSON.parse(built.manifestText) as Record<string, unknown>;
    expect(FhirDefinitions.open({ ...manifest, indexFormat: "1.4.0" }).ok).toBe(true);
    expect(FhirDefinitions.open({ ...manifest, indexFormat: "2.0.0" }).issues[0]?.code).toBe(
      "INDEX_FORMAT_UNSUPPORTED",
    );
    expect(FhirDefinitions.open({ ...manifest, entries: [{ url: "x" }] }).issues[0]?.code).toBe(
      "INDEX_MALFORMED",
    );
    expect(FhirDefinitions.open([]).issues[0]?.code).toBe("INDEX_MALFORMED");
  });

  it("identifies an index by the SHA-256 of its manifest", () => {
    const a = index().manifestText;
    expect(indexId(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(indexId(a)).toBe(indexId(index().manifestText));
    expect(indexId(a)).not.toBe(indexId(`${a} `));
  });
});
