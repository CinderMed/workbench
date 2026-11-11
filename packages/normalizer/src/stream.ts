/**
 * Streaming normalization: the data file comes in chunks (text or bytes) and every complete record
 * is normalized as soon as it is read, so memory does not grow with the number of rows. The
 * whole-file `normalize` is built on it and still gives the reference normalizer's output.
 */
import type { NormalizationSpec } from "@cindermed/model";
import { canonicalText } from "@cindermed/model";
import { CsvReader } from "./csv.js";
import { createDecoder, type InputSettings } from "./decode.js";
import type { HashKey } from "./ids.js";
import {
  normalizeRow,
  resolveHashKey,
  type NormalizationIssue,
  type NormalizeOptions,
  type NormalizeResult,
  type NormalizedRow,
} from "./normalize.js";

/** What the normalizer reports while it reads: a row, an issue, or the stop of `fail`. */
export type NormalizerEvent =
  | { readonly kind: "row"; readonly row: NormalizedRow }
  | { readonly kind: "issue"; readonly issue: NormalizationIssue }
  | { readonly kind: "failed"; readonly failure: NormalizationIssue };

/** Reads one data file in chunks. After a `failed` event it ignores the rest of the file. */
export interface Normalizer {
  push(chunk: string | Uint8Array): NormalizerEvent[];
  end(): NormalizerEvent[];
}

/** The reading settings: schema defaults, then the specification, then the run-time options. */
export function inputSettings(
  spec: NormalizationSpec,
  options: Pick<NormalizeOptions, "input"> = {},
): InputSettings {
  return {
    delimiter: ",",
    quote: '"',
    encoding: "utf-8",
    headerRow: 1,
    ...spec.input,
    ...options.input,
  };
}

/**
 * A streaming normalizer for one data file. Records with only empty cells are skipped and not
 * counted; the `headerRow`-th record is the header (names in NFC, trimmed), and the records after
 * it are the data rows, numbered from 1. Fails at once when the HMAC key is missing.
 */
export function createNormalizer(
  spec: NormalizationSpec,
  options: NormalizeOptions = {},
):
  | { readonly ok: true; readonly normalizer: Normalizer }
  | { readonly ok: false; readonly failure: NormalizationIssue } {
  const resolved = resolveHashKey(spec, options);
  if ("failure" in resolved) return { ok: false, failure: resolved.failure };
  const key: HashKey | undefined = resolved.key;
  const settings = inputSettings(spec, options);
  const decoder = createDecoder(settings.encoding);
  const reader = new CsvReader(settings);
  let records = 0;
  let header: string[] = [];
  let failed = false;

  const handle = (batch: string[][]): NormalizerEvent[] => {
    const events: NormalizerEvent[] = [];
    for (const cells of batch) {
      if (failed) break;
      if (!cells.some((cell) => cell !== "")) continue;
      records++;
      if (records < settings.headerRow) continue;
      if (records === settings.headerRow) {
        header = cells.map(canonicalText);
        continue;
      }
      const record = new Map(header.map((name, i) => [name, cells[i] ?? ""]));
      const row = records - settings.headerRow;
      const outcome = normalizeRow(spec, record, key === undefined ? { row } : { row, key });
      if (outcome.kind === "failed") {
        failed = true;
        events.push({ kind: "failed", failure: outcome.failure });
        break;
      }
      for (const issue of outcome.issues) events.push({ kind: "issue", issue });
      if (outcome.kind === "row") events.push({ kind: "row", row: outcome.row });
    }
    return events;
  };

  return {
    ok: true,
    normalizer: {
      push: (chunk) => (failed ? [] : handle(reader.push(decoder.push(chunk)))),
      end: () => (failed ? [] : handle([...reader.push(decoder.end()), ...reader.end()])),
    },
  };
}

/** Normalizes a data file given as chunks (for example a Node stream), one event at a time. */
export async function* normalizeStream(
  spec: NormalizationSpec,
  chunks: AsyncIterable<string | Uint8Array> | Iterable<string | Uint8Array>,
  options: NormalizeOptions = {},
): AsyncGenerator<NormalizerEvent> {
  const created = createNormalizer(spec, options);
  if (!created.ok) {
    yield { kind: "failed", failure: created.failure };
    return;
  }
  for await (const chunk of chunks) {
    for (const event of created.normalizer.push(chunk)) {
      yield event;
      if (event.kind === "failed") return;
    }
  }
  yield* created.normalizer.end();
}

/** Normalizes a whole data file, as the reference normalizer does. */
export function normalize(
  spec: NormalizationSpec,
  input: string | Uint8Array,
  options: NormalizeOptions = {},
): NormalizeResult {
  const created = createNormalizer(spec, options);
  if (!created.ok) return { ok: false, failure: created.failure };
  const rows: NormalizedRow[] = [];
  const issues: NormalizationIssue[] = [];
  for (const event of [...created.normalizer.push(input), ...created.normalizer.end()]) {
    if (event.kind === "failed") return { ok: false, failure: event.failure };
    if (event.kind === "row") rows.push(event.row);
    else issues.push(event.issue);
  }
  return { ok: true, rows, issues };
}
