// Differential test: @cindermed/normalizer and the reference normalizer
// (fixtures/fml-examples/tools/normalize.mjs) give the same rows, byte for byte, and the same
// issues (row, column or id field, kind, value) for the same specification and file bytes.
// Messages are not compared: ours never hold cell values. Outputs go to .tmp/.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Normalization, NormalizationSpec } from "../packages/model/src/index.js";
import { afterAll, describe, expect, it } from "vitest";
import { normalize, serializeRows } from "../packages/normalizer/src/index.js";

const root = resolve(import.meta.dirname, "..");
const work = join(root, ".tmp", "normalizer-reference");

interface Case {
  readonly name: string;
  readonly columns: Normalization.Column[];
  readonly ids?: Normalization.IdField[];
  readonly onInvalidValue?: NormalizationSpec["onInvalidValue"];
  readonly encoding?: NonNullable<NormalizationSpec["input"]["encoding"]>;
  readonly timeZones?: NormalizationSpec["timeZones"];
  readonly bytes: Uint8Array;
}

/** The workbench's tzdata snapshot (ADR-0024), reduced to the zones a case uses. */
const snapshot = JSON.parse(
  readFileSync(join(root, "packages/export/src/time-zones/zones.json"), "utf8"),
) as { tzdata: string; from: number; to: number; zones: Record<string, [number, ...number[]]> };
const zonesOf = (...names: string[]): NormalizationSpec["timeZones"] => ({
  tzdata: snapshot.tzdata,
  from: snapshot.from,
  to: snapshot.to,
  zones: Object.fromEntries(names.map((name) => [name, snapshot.zones[name] ?? [0]])),
});

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const id = (extra: Partial<Normalization.IdField>): Normalization.IdField => ({
  field: "id_T0",
  literals: ["t"],
  columns: ["a"],
  encoding: "hash",
  ...extra,
});

const cases: readonly Case[] = [
  {
    name: "CSV quoting, CRLF line ends and a UTF-8 byte order mark",
    columns: [
      { name: "a", sourceName: "a", type: "string" },
      { name: "b", sourceName: "b col", type: "string" },
    ],
    encoding: "utf-8-bom",
    bytes: utf8('\uFEFFa, b col \r\n"x, ""y""","line\nbreak"\r\n,\r\n  Sì  ,z'),
  },
  {
    name: "iso-8859-1 decoded as windows-1252 (0x80 → €)",
    columns: [{ name: "a", sourceName: "a", type: "string" }],
    encoding: "iso-8859-1",
    bytes: new Uint8Array([0x61, 0x0a, 0x80, 0x31, 0x0a, 0xe9, 0x9f, 0x0a]),
  },
  {
    name: "missing values, multiple choice and allowed values",
    columns: [
      {
        name: "m",
        sourceName: "m",
        type: "string",
        allowedValues: ["1", "2", "Sì"],
        missingValues: ["NA"],
        multiValue: { separator: "," },
      },
      { name: "c", sourceName: "c", type: "code", allowedValues: ["Sì", "No"] },
    ],
    bytes: utf8('m,c\n"2, 1,2,",Sì\nNA,sì\n"3,1",No\n"Si\u0300",NO\n'),
  },
  {
    name: "numbers, booleans and dates, rows rejected",
    columns: [
      { name: "i", sourceName: "i", type: "integer" },
      { name: "d", sourceName: "d", type: "decimal", decimalSeparator: "," },
      { name: "b", sourceName: "b", type: "boolean", trueValues: ["Sì"], falseValues: ["No"] },
      { name: "t", sourceName: "t", type: "date", dateFormat: "dd/MM/yyyy" },
    ],
    onInvalidValue: "reject-row",
    bytes: utf8(
      'i,d,b,t\n+012345678901234567890,"011,20",sì,17/09/2023\n1,"1.234",no,31/02/2023\n-0,"-0,5",NO,29/02/2024\n',
    ),
  },
  {
    name: "hash and sanitize ids, a missing id column and an id that is too long",
    columns: [
      { name: "a", sourceName: "a", type: "string" },
      { name: "b", sourceName: "b", type: "date", dateFormat: "dd/MM/yyyy" },
    ],
    ids: [
      id({ columns: ["a", "b"], hashLength: 10 }),
      id({ field: "id_T1", encoding: "sanitize", literals: ["", "s"], separator: "." }),
      id({ field: "id_T2", encoding: "sanitize", literals: ["x".repeat(60)] }),
    ],
    bytes: utf8("a,b\n10 42,17/09/2023\nàb,\n"),
  },
  {
    // Normalization 1.3.0 (#107, ADR-0024). Europe/Rome in 2025: 30/03 02:30 does not exist
    // (invalid), 26/10 02:30 occurs twice (the earlier, +02:00), 26/10 03:00 is +01:00 again.
    // New York in MIMIC-IV's shifted years; times before 1970 or from 2300 are outside the
    // snapshot; a date-only format has no offset; ids are computed over the value with its offset.
    name: "time zones: fixed offsets, both daylight-saving changes, the range and ids",
    columns: [
      {
        name: "rome",
        sourceName: "rome",
        type: "dateTime",
        dateFormat: "dd/MM/yyyy HH:mm",
        timeZone: "Europe/Rome",
      },
      { name: "kol", sourceName: "kol", type: "dateTime", timeZone: "+05:30" },
      { name: "utc", sourceName: "utc", type: "dateTime", timeZone: "Z" },
      {
        name: "ny",
        sourceName: "ny",
        type: "dateTime",
        dateFormat: "yyyy-MM-dd HH:mm:ss",
        timeZone: "America/New_York",
      },
      {
        name: "day",
        sourceName: "day",
        type: "dateTime",
        dateFormat: "yyyy-MM-dd",
        timeZone: "Europe/Rome",
      },
    ],
    ids: [id({ columns: ["rome"] })],
    timeZones: zonesOf("America/New_York", "Europe/Rome"),
    bytes: utf8(
      [
        "rome,kol,utc,ny,day",
        "15/01/2025 10:00,2025-01-15T10:00:00,2025-01-15T10:00:00,2113-08-04 18:46:00,2025-03-30",
        "15/07/2025 10:00,,,2120-01-30 19:44:00,",
        "30/03/2025 02:30,,,,",
        "30/03/2025 03:00,,,,",
        "26/10/2025 02:30,,,,",
        "26/10/2025 03:00,,,,",
        "31/12/1969 23:00,,,2300-01-01 00:00:00,",
      ].join("\n"),
    ),
  },
  {
    name: "time zones: an offset that is not a whole number of minutes is invalid",
    columns: [
      {
        name: "t",
        sourceName: "t",
        type: "dateTime",
        dateFormat: "yyyy-MM-dd HH:mm",
        timeZone: "Africa/Monrovia",
      },
    ],
    timeZones: zonesOf("Africa/Monrovia"),
    // Liberia was at -00:44:30 until 7 January 1972.
    bytes: utf8("t\n1971-06-01 12:00\n1972-06-01 12:00\n"),
  },
  {
    name: "onInvalidValue: fail stops at a value outside the allowed values",
    columns: [{ name: "c", sourceName: "c", type: "code", allowedValues: ["Sì", "No"] }],
    onInvalidValue: "fail",
    bytes: utf8("c\nSì\nsì\nmaybe\n"),
  },
];

interface Issue {
  row: number;
  where: string;
  kind: string;
  value: string;
}

const PATTERNS: readonly [RegExp, string][] = [
  [/^row (\d+), (.+): invalid value "(.*)" for \w+/, "invalidValue"],
  [/^row (\d+), (.+): value "(.*)" is not an allowed value/, "notAllowed"],
  [/^row (\d+): invalid id for (\S+): (.*)$/, "invalidId"],
];

function referenceIssues(stderr: string): Issue[] {
  return stderr
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      for (const [pattern, kind] of PATTERNS) {
        const match = pattern.exec(line);
        if (match)
          return { row: Number(match[1]), where: match[2] ?? "", kind, value: match[3] ?? "" };
      }
      throw new Error(`unexpected reference message: ${line}`);
    });
}

function run(c: Case, index: number) {
  const spec: NormalizationSpec = {
    formatVersion: "1.3.0",
    source: "T",
    logicalModel: "http://example.org/StructureDefinition/TRow",
    input: { format: "csv", ...(c.encoding === undefined ? {} : { encoding: c.encoding }) },
    onInvalidValue: c.onInvalidValue ?? "report-drop",
    columns: c.columns as NormalizationSpec["columns"],
    ids: c.ids ?? [],
    ...(c.timeZones === undefined ? {} : { timeZones: c.timeZones }),
  };
  const specFile = join(work, `spec-${String(index)}.json`);
  const dataFile = join(work, `rows-${String(index)}.csv`);
  writeFileSync(specFile, JSON.stringify(spec));
  writeFileSync(dataFile, c.bytes);
  const reference = spawnSync(
    process.execPath,
    [join(root, "fixtures/fml-examples/tools/normalize.mjs"), specFile, dataFile],
    { encoding: "utf8" },
  );
  return { reference, ours: normalize(spec, c.bytes) };
}

describe("normalizer matches the reference normalizer", () => {
  mkdirSync(work, { recursive: true });
  afterAll(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it.each(cases.map((c, i) => [c.name, c, i] as const))("%s", (_name, c, i) => {
    const { reference, ours } = run(c, i);
    const expected = referenceIssues(reference.stderr);
    if (!ours.ok) {
      expect(reference.status).toBe(1);
      expect(reference.stdout).toBe("");
      const { row, column, kind, value } = ours.failure;
      expect([{ row, where: column, kind, value }]).toEqual(expected);
      return;
    }
    expect(reference.status).toBe(0);
    expect(serializeRows(ours.rows)).toBe(reference.stdout);
    expect(
      ours.issues.map((issue) => ({
        row: issue.row,
        where: issue.column ?? issue.idField,
        kind: issue.kind,
        value: issue.value,
      })),
    ).toEqual(expected);
  });
});
