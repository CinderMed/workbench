// The TypeScript normalizer (@cindermed/normalizer, built) with the command line and messages of the
// reference fixtures/fml-examples/tools/normalize.mjs, so tests/run-all.sh can run either one
// (NORMALIZE). The messages here repeat the cell value, as the reference's do: this is test tooling
// on example data; the package itself keeps values out of messages (ADR-0010).
// Usage: node tooling/golden/normalize-ts.mjs spec.json rows.csv > out.json
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const { normalize, serializeRows } = await import(
  resolve(root, "packages/normalizer/dist/index.js")
);
const [specFile, dataFile] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specFile, "utf8"));
const types = new Map(spec.columns.map((c) => [c.sourceName, c.type]));

/** The reference normalizer's message for an issue. */
function message(issue) {
  if (issue.kind === "invalidValue")
    return `row ${issue.row}, ${issue.column}: invalid value "${issue.value}" for ${types.get(issue.column)}`;
  if (issue.kind === "notAllowed")
    return `row ${issue.row}, ${issue.column}: value "${issue.value}" is not an allowed value`;
  if (issue.kind === "invalidId")
    return `row ${issue.row}: invalid id for ${issue.idField}: ${issue.value}`;
  return issue.message;
}

const result = normalize(spec, readFileSync(dataFile));
if (!result.ok) {
  process.stderr.write(`${message(result.failure)} (onInvalidValue: fail)\n`);
  process.exit(1);
}
process.stdout.write(serializeRows(result.rows));
if (result.issues.length > 0) process.stderr.write(result.issues.map(message).join("\n") + "\n");
