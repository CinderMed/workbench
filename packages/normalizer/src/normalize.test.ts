import type { Normalization, NormalizationSpec } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import {
  computeId,
  decodeInput,
  hashHex,
  normalize,
  packageName,
  parseCsv,
  serializeRows,
  type NormalizedRow,
} from "./index.js";

const model = "http://example.org/StructureDefinition/TRow";

function specOf(
  columns: Normalization.Column[],
  extra: Partial<NormalizationSpec> = {},
): NormalizationSpec {
  return {
    formatVersion: "1.2.0",
    source: "T",
    logicalModel: model,
    input: { format: "csv" },
    onInvalidValue: "report-drop",
    columns: columns as NormalizationSpec["columns"],
    ids: [],
    ...extra,
  };
}

function rows(spec: NormalizationSpec, csv: string | Uint8Array): NormalizedRow[] {
  const result = normalize(spec, csv);
  if (!result.ok) throw new Error(result.failure.message);
  return result.rows;
}

describe("@cindermed/normalizer", () => {
  it("exposes its package name", () => {
    expect(packageName).toBe("@cindermed/normalizer");
  });
});

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes, line ends inside quotes and every line end", () => {
    expect(parseCsv('a,"b,""c"""\r\n"x\ny",z\rlast,')).toEqual([
      ["a", 'b,"c"'],
      ["x\ny", "z"],
      ["last", ""],
    ]);
  });

  it("uses the delimiter and quote it is given", () => {
    expect(parseCsv("a;'b;c'\n", { delimiter: ";", quote: "'" })).toEqual([["a", "b;c"]]);
  });
});

describe("decodeInput", () => {
  it("decodes iso-8859-1 as windows-1252 (WHATWG): 0x80 is €", () => {
    expect(decodeInput(new Uint8Array([0x80, 0x9f, 0xe9]), "iso-8859-1")).toBe("€Ÿé");
    expect(decodeInput(new Uint8Array([0x80]), "windows-1252")).toBe("€");
  });

  it("drops a leading byte order mark from bytes and from text", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);
    expect(decodeInput(bytes, "utf-8-bom")).toBe("a");
    expect(decodeInput(bytes, "utf-8")).toBe("a");
    expect(decodeInput("\uFEFFa", "utf-8")).toBe("a");
  });
});

describe("normalize", () => {
  it("keeps integers and decimals as canonical text, never as JS numbers", () => {
    const spec = specOf([
      { name: "n", sourceName: "n", type: "integer" },
      { name: "d", sourceName: "d", type: "decimal", decimalSeparator: "," },
    ]);
    const [row] = rows(spec, 'n,d\n+012345678901234567890,"011,20"\n');
    expect(row).toEqual({
      resourceType: model,
      n: { kind: "number", text: "12345678901234567890" },
      d: { kind: "number", text: "11.20" },
    });
    expect(serializeRows(row === undefined ? [] : [row])).toBe(
      `{\n  "resourceType": "${model}",\n  "n": 12345678901234567890,\n  "d": 11.20\n}\n`,
    );
  });

  it("splits multiple choices, checks every part, and drops missing values", () => {
    const spec = specOf([
      {
        name: "m",
        sourceName: "m",
        type: "string",
        allowedValues: ["1", "2"],
        multiValue: { separator: "|" },
      },
      { name: "s", sourceName: "s", type: "string", missingValues: ["NA"] },
    ]);
    const result = normalize(spec, "m,s\n2| 1 |2|,NA\n3|1,x\n");
    expect(result).toMatchObject({
      ok: true,
      rows: [
        { resourceType: model, m: ["2", "1"] },
        { resourceType: model, m: ["1"], s: "x" },
      ],
      issues: [{ kind: "notAllowed", row: 2, column: "m", value: "3" }],
    });
  });

  it("drops the whole row with reject-row", () => {
    const spec = specOf([{ name: "b", sourceName: "b", type: "boolean" }], {
      onInvalidValue: "reject-row",
    });
    const result = normalize(spec, "b\nY\nmaybe\nno\n");
    expect(result).toMatchObject({
      ok: true,
      rows: [
        { resourceType: model, b: true },
        { resourceType: model, b: false },
      ],
      issues: [{ kind: "invalidValue", row: 2, value: "maybe" }],
    });
  });

  it("uses trueValues and falseValues when a specification declares them", () => {
    const spec = specOf([
      { name: "b", sourceName: "b", type: "boolean", trueValues: ["Sì"], falseValues: ["No"] },
    ]);
    expect(rows(spec, "b\nsì\nNO\n").map((row) => row["b"])).toEqual([true, false]);
  });

  it("reads dates and date-times with their format", () => {
    const spec = specOf([
      { name: "d", sourceName: "d", type: "date", dateFormat: "dd/MM/yyyy" },
      { name: "t", sourceName: "t", type: "dateTime", dateFormat: "dd/MM/yyyy HH:mm" },
    ]);
    expect(rows(spec, "d,t\n17/09/2023,17/09/2023 14:05\n")).toEqual([
      { resourceType: model, d: "2023-09-17", t: "2023-09-17T14:05:00" },
    ]);
  });

  it("applies the run-time input settings over the specification", () => {
    const spec = specOf([{ name: "a", sourceName: "a", type: "code" }]);
    const result = normalize(spec, "title\na;b\nx;y\n", {
      input: { delimiter: ";", headerRow: 2 },
    });
    expect(result).toMatchObject({ ok: true, rows: [{ a: "x" }] });
  });

  it("gives no rows for an empty file", () => {
    expect(normalize(specOf([{ name: "a", sourceName: "a", type: "code" }]), "")).toEqual({
      ok: true,
      rows: [],
      issues: [],
    });
    expect(serializeRows([])).toBe("[]\n");
  });
});

describe("ids", () => {
  const field = (encoding: "hash" | "sanitize"): Normalization.IdField => ({
    field: "id_T0",
    literals: ["pat", ""],
    columns: ["a", "d"],
    encoding,
  });

  it("hashes the canonical values joined by U+001F, with SHA-256 or HMAC-SHA256", () => {
    expect(hashHex("1042\u001f2023-09-17")).toBe(
      "4875440a9853f1a3f994e45240446c8ea65a189d9662054cabf5579e94d8759a",
    );
    expect(hashHex("1042\u001f2023-09-17", "secret-key")).toBe(
      "94032035b47574fbd267786e9b059bd9ce39715afbf61b1b6af85d43ffe952c4",
    );
    expect(hashHex("1042", new Uint8Array([1, 2, 3]))).toBe(
      "1e4cbaa2e510bfa105add18aacc89e383253ec1740386b858d0e147a19f4d1cb",
    );
    expect(computeId(field("hash"), ["1042", "2023-09-17"])).toBe("pat-4875440a9853f1a3f994e452");
    expect(
      computeId({ ...field("hash"), hashLength: 8, separator: "." }, ["1042", "2023-09-17"]),
    ).toBe("pat.4875440a");
  });

  it("sanitizes the joined values", () => {
    expect(computeId(field("sanitize"), ["10 42", "2023-09-17"])).toBe("pat-10-42-2023-09-17");
  });

  const spec = (extra: Partial<NormalizationSpec>) =>
    specOf(
      [
        { name: "a", sourceName: "a", type: "string" },
        { name: "d", sourceName: "d", type: "date", dateFormat: "dd/MM/yyyy" },
      ],
      { ids: [field("hash")], ...extra },
    );

  it("computes HMAC ids with the caller's key, and fails without it", () => {
    const keyed = spec({ hash: { algorithm: "sha256", keyId: "site-key" } });
    const result = normalize(keyed, "a,d\n1042,17/09/2023\n", {
      hmacKey: (keyId) => (keyId === "site-key" ? "secret-key" : undefined),
    });
    expect(result).toMatchObject({ ok: true, rows: [{ id_T0: "pat-94032035b47574fbd267786e" }] });
    const missing = normalize(keyed, "a,d\n1042,17/09/2023\n", { hmacKey: () => undefined });
    expect(missing).toEqual({
      ok: false,
      failure: {
        kind: "hmacKeyMissing",
        message: "no HMAC key for the key id of the specification (hash.keyId)",
      },
    });
  });

  it("skips the id when a column is missing, and reports an id that is not a FHIR id", () => {
    expect(rows(spec({}), "a,d\n1042,\n")).toEqual([{ resourceType: model, a: "1042" }]);
    const long = spec({ ids: [{ ...field("sanitize"), literals: ["x".repeat(60)] }] });
    const result = normalize(long, "a,d\n1042,17/09/2023\n");
    expect(result).toMatchObject({
      ok: true,
      issues: [{ kind: "invalidId", row: 1, idField: "id_T0" }],
    });
    if (result.ok) expect(result.issues[0]?.message).not.toContain("1042");
  });
});
