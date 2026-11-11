// Differential test: the shared cell parsers of @cindermed/model accept and convert exactly what
// the reference normalizer (fixtures/fml-examples/tools/normalize.mjs) does. Outputs go to .tmp/.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  canonicalText,
  parseBoolean,
  parseDate,
  parseDateTime,
  parseDecimal,
  parseInteger,
} from "../packages/model/src/values/index.js";

const root = resolve(import.meta.dirname, "..");
const work = join(root, ".tmp", "values-reference");

interface Case {
  readonly type: "integer" | "decimal" | "boolean" | "date" | "dateTime";
  readonly dateFormat?: string;
  readonly decimalSeparator?: "." | ",";
  readonly values: readonly string[];
}

const cases: readonly Case[] = [
  { type: "integer", values: ["42", "+007", "-0", "-12", "1.0", "abc", "1e3"] },
  { type: "decimal", values: ["11.20", "011.20", "+3", "-007.5", "11,20", ".5", "11."] },
  { type: "decimal", decimalSeparator: ",", values: ["11,20", "0,5", "1.234,5", "11.20", "x"] },
  { type: "boolean", values: ["1", "TRUE", "yes", "Y", "0", "False", "NO", "n", "Sì", "si", "2"] },
  {
    type: "date",
    dateFormat: "dd/MM/yyyy",
    values: ["17/09/2023", "29/02/2024", "31/02/2023", "00/01/2023", "2023-09-17"],
  },
  { type: "date", values: ["2023-09-17", "2023-9-17", "17/09/2023"] },
  { type: "date", dateFormat: "yyyy", values: ["2023", "23"] },
  { type: "date", dateFormat: "MM/yyyy", values: ["09/2023", "13/2023"] },
  {
    type: "dateTime",
    dateFormat: "dd/MM/yyyy HH:mm",
    values: ["17/09/2023 14:05", "17/09/2023 24:00", "17/09/2023"],
  },
  { type: "dateTime", values: ["2023-09-17T23:59:59", "2023-09-17"] },
];

function ours(c: Case, text: string): string | boolean | undefined {
  const value = canonicalText(text);
  switch (c.type) {
    case "integer":
      return parseInteger(value);
    case "decimal":
      return parseDecimal(value, c.decimalSeparator);
    case "boolean":
      return parseBoolean(value);
    case "date":
      return parseDate(value, c.dateFormat);
    case "dateTime":
      return parseDateTime(value, c.dateFormat);
  }
}

/** Runs the reference normalizer on one column holding every value of a case, one row each. */
function reference(c: Case, index: number): (string | boolean | undefined)[] {
  const column = {
    name: "v",
    sourceName: "v",
    type: c.type,
    ...(c.dateFormat === undefined ? {} : { dateFormat: c.dateFormat }),
    ...(c.decimalSeparator === undefined ? {} : { decimalSeparator: c.decimalSeparator }),
  };
  const spec = {
    formatVersion: "1.1.0",
    source: "T",
    logicalModel: "http://example.org/StructureDefinition/TRow",
    input: { format: "csv" },
    onInvalidValue: "report-drop",
    columns: [column],
    ids: [],
  };
  const specFile = join(work, `spec-${String(index)}.json`);
  const csvFile = join(work, `rows-${String(index)}.csv`);
  writeFileSync(specFile, JSON.stringify(spec));
  // Each row also has a marker column, so a row whose value is dropped is still written.
  writeFileSync(csvFile, ["v,marker", ...c.values.map((v, i) => `"${v}",${String(i)}`)].join("\n"));
  const output = execFileSync(
    process.execPath,
    [join(root, "fixtures/fml-examples/tools/normalize.mjs"), specFile, csvFile],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  // The normalizer writes numbers with their original digits (11.20); quote them so they stay text.
  const quoted = output.replace(/"v": (-?\d+(?:\.\d+)?)(?=,|\n)/g, '"v": "$1"');
  const parsed = JSON.parse(quoted) as { v?: string | boolean } | { v?: string | boolean }[];
  return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => row.v);
}

describe("shared cell parsers match the reference normalizer", () => {
  mkdirSync(work, { recursive: true });
  afterAll(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it.each(
    cases.map(
      (c, i) =>
        [
          `${c.type}${c.dateFormat === undefined ? "" : ` ${c.dateFormat}`}${c.decimalSeparator === undefined ? "" : ` '${c.decimalSeparator}'`}`,
          c,
          i,
        ] as const,
    ),
  )("%s", (_name, c, i) => {
    expect(c.values.map((v) => ours(c, v))).toEqual(reference(c, i));
  });
});
