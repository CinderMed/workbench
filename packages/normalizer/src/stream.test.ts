import type { Normalization, NormalizationSpec } from "@cindermed/model";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import {
  CsvReader,
  createDecoder,
  createNormalizer,
  normalize,
  normalizeRow,
  normalizeStream,
  parseCsv,
  serializeRowNdjson,
  type NormalizerEvent,
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
    ids: [{ field: "id_T0", literals: ["t"], columns: ["a"], encoding: "hash" }],
    ...extra,
  };
}

const spec = specOf([
  { name: "a", sourceName: "a", type: "string" },
  { name: "n", sourceName: "n", type: "decimal", decimalSeparator: "," },
  { name: "c", sourceName: "c", type: "code", allowedValues: ["Sì", "No"] },
]);

// Quoted cells with delimiters, doubled quotes and line breaks; CRLF and CR line ends; multi-byte
// characters (2, 3 and 4 bytes in UTF-8); an empty line and a value outside the allowed values.
const text = '\uFEFFa,n,c\r\n"x, ""q""\r\nnext","1,5",Sì\r\n\r\n€ 𝄞,"011,20",No\rlast,2,sì\n"end"';
const bytes = utf8ToBytes(text);

/** Events of the whole input given in the chunks that `split` cuts. */
function events(chunks: readonly (string | Uint8Array)[], s = spec): NormalizerEvent[] {
  const created = createNormalizer(s);
  if (!created.ok) throw new Error(created.failure.message);
  return [
    ...chunks.flatMap((chunk) => created.normalizer.push(chunk)),
    ...created.normalizer.end(),
  ];
}

const whole = events([bytes]);

describe("CsvReader", () => {
  it("gives the same records for one-character chunks as for the whole text", () => {
    const reader = new CsvReader();
    const records = [...Array.from(text).flatMap((ch) => reader.push(ch)), ...reader.end()];
    expect(records).toEqual(parseCsv(text));
  });

  it("keeps a doubled quote and a CR LF that a chunk boundary splits", () => {
    const reader = new CsvReader();
    expect([...reader.push('"a"'), ...reader.push('"b",c\r'), ...reader.push("\nd")]).toEqual([
      ['a"b', "c"],
    ]);
    expect(reader.end()).toEqual([["d"]]);
  });
});

describe("streaming normalization", () => {
  it("reads every row of the sample (sanity check of the whole input)", () => {
    expect(whole.filter((e) => e.kind === "row")).toHaveLength(4);
    expect(whole.filter((e) => e.kind === "issue")).toMatchObject([
      { issue: { kind: "notAllowed", row: 3, column: "c", value: "sì" } },
    ]);
  });

  it("gives the same events for every split of the bytes into two chunks", () => {
    for (let i = 0; i <= bytes.length; i++) {
      expect(events([bytes.subarray(0, i), bytes.subarray(i)])).toEqual(whole);
    }
  });

  it("gives the same events for one-byte chunks and for text chunks", () => {
    expect(events([...bytes].map((b) => new Uint8Array([b])))).toEqual(whole);
    expect(events(Array.from(text))).toEqual(whole);
  });

  it("decodes a multi-byte character split across chunks once", () => {
    const decoder = createDecoder("utf-8");
    const euro = utf8ToBytes("€");
    expect(decoder.push(euro.subarray(0, 1)) + decoder.push(euro.subarray(1)) + decoder.end()).toBe(
      "€",
    );
  });

  it("stops at the first invalid value with fail and ignores the rest", async () => {
    const failing = { ...spec, onInvalidValue: "fail" as const };
    const created = createNormalizer(failing);
    if (!created.ok) throw new Error("unexpected");
    const first = created.normalizer.push(text);
    expect(first.at(-1)).toMatchObject({ kind: "failed", failure: { row: 3, value: "sì" } });
    expect(created.normalizer.push("more,1,No\n")).toEqual([]);
    expect(created.normalizer.end()).toEqual([]);

    const streamed: NormalizerEvent[] = [];
    for await (const event of normalizeStream(failing, [text.slice(0, 10), text.slice(10)])) {
      streamed.push(event);
    }
    expect(streamed).toEqual(first);
  });

  it("streams from an async source and reports a missing HMAC key as the only event", async () => {
    async function* source() {
      yield await Promise.resolve(text.slice(0, 7));
      yield await Promise.resolve(text.slice(7));
    }
    const streamed: NormalizerEvent[] = [];
    for await (const event of normalizeStream(spec, source())) streamed.push(event);
    expect(streamed).toEqual(events([text]));

    const keyed = { ...spec, hash: { algorithm: "sha256" as const, keyId: "k" } };
    const missing: NormalizerEvent[] = [];
    for await (const event of normalizeStream(keyed, [text])) missing.push(event);
    expect(missing).toEqual([
      { kind: "failed", failure: expect.objectContaining({ kind: "hmacKeyMissing" }) as unknown },
    ]);
    expect(normalize(keyed, text)).toMatchObject({
      ok: false,
      failure: { kind: "hmacKeyMissing" },
    });
  });
});

describe("normalizeRow", () => {
  it("normalizes one record, purely: the same input gives the same outcome", () => {
    const record = new Map([
      ["a", " 10 "],
      ["n", "1,50"],
      ["c", "No"],
    ]);
    const outcome = normalizeRow(spec, record, { row: 7 });
    expect(outcome).toEqual(normalizeRow(spec, record, { row: 7 }));
    expect(outcome).toMatchObject({
      kind: "row",
      issues: [],
      row: { resourceType: model, a: "10", n: { kind: "number", text: "1.50" }, c: "No" },
    });
  });

  it("returns a rejected row with reject-row", () => {
    const rejecting = { ...spec, onInvalidValue: "reject-row" as const };
    expect(normalizeRow(rejecting, new Map([["c", "x"]]), { row: 1 })).toMatchObject({
      kind: "rejected",
      issues: [{ kind: "notAllowed", row: 1 }],
    });
  });
});

describe("serializeRowNdjson", () => {
  it("writes one compact line per row, numbers with their digits", () => {
    expect(
      serializeRowNdjson({
        resourceType: model,
        n: { kind: "number", text: "12345678901234567890" },
        d: { kind: "number", text: "11.20" },
        m: ["1", { kind: "number", text: "2" }],
        b: true,
        s: 'a "q"\n',
      }),
    ).toBe(
      `{"resourceType":"${model}","n":12345678901234567890,"d":11.20,"m":["1",2],"b":true,"s":"a \\"q\\"\\n"}\n`,
    );
  });
});
