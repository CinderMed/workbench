/**
 * Reference implementation of the normalization specification (normalization.schema.json 1.2.0,
 * specification "Normalization: what happens to each cell"). It reproduces
 * fixtures/fml-examples/tools/normalize.mjs exactly; a differential test keeps the two in step.
 * No I/O (ADR-0001): text or bytes in, rows and reports out.
 */
import {
  canonicalText,
  parseBoolean,
  parseDate,
  parseDateTime,
  parseDecimal,
  parseInteger,
  type Normalization,
  type NormalizationSpec,
} from "@cindermed/model";
import { parseCsv } from "./csv.js";
import { decodeInput, type InputSettings } from "./decode.js";
import { computeId, type HashKey } from "./ids.js";

/** An integer or decimal, kept as its canonical text: never a JS number (digits are kept). */
export interface NumberText {
  readonly kind: "number";
  readonly text: string;
}

export type CellValue = string | boolean | NumberText;
export type NormalizedValue = CellValue | readonly CellValue[];

/** One normalized row: `resourceType` (the logical model URL) first, then the elements. */
export type NormalizedRow = Readonly<Record<string, NormalizedValue>>;

export type IssueKind = "invalidValue" | "notAllowed" | "invalidId" | "hmacKeyMissing";

/**
 * A problem found while normalizing. Messages never hold cell values, ids or keys, so they can be
 * logged; the offending text is only in `value`.
 */
export interface NormalizationIssue {
  readonly kind: IssueKind;
  /** Data row, from 1 (rows with only empty cells are not counted). */
  readonly row?: number;
  /** Source column (`sourceName`) of a cell issue. */
  readonly column?: string;
  /** Id field of an `invalidId` issue. */
  readonly idField?: string;
  /** The cell value or the computed id. May hold patient data: do not log it. */
  readonly value?: string;
  readonly message: string;
}

export interface NormalizeOptions {
  /** Run-time reading settings, over the specification's `input` (ADR-0009). */
  readonly input?: Partial<InputSettings>;
  /** Key for HMAC ids (`hash.keyId`), kept outside the package; `undefined` when unknown. */
  readonly hmacKey?: (keyId: string) => HashKey | undefined;
}

export type NormalizeResult =
  | { readonly ok: true; readonly rows: NormalizedRow[]; readonly issues: NormalizationIssue[] }
  | { readonly ok: false; readonly failure: NormalizationIssue };

const DEFAULT_TRUE = ["1", "true", "yes", "y"];
const DEFAULT_FALSE = ["0", "false", "no", "n"];

function convertBoolean(value: string, column: Normalization.Column): boolean | undefined {
  if (column.trueValues === undefined && column.falseValues === undefined) {
    return parseBoolean(value);
  }
  const lower = value.toLowerCase();
  const matches = (list: readonly string[]) => list.some((item) => item.toLowerCase() === lower);
  if (matches(column.trueValues ?? DEFAULT_TRUE)) return true;
  if (matches(column.falseValues ?? DEFAULT_FALSE)) return false;
  return undefined;
}

/** Step 4: conversion by type, or `undefined` when the value does not fit. */
function convert(value: string, column: Normalization.Column): CellValue | undefined {
  const number = (text: string | undefined): NumberText | undefined =>
    text === undefined ? undefined : { kind: "number", text };
  switch (column.type) {
    case "string":
    case "code":
      return value;
    case "integer":
      return number(parseInteger(value));
    case "decimal":
      return number(parseDecimal(value, column.decimalSeparator ?? "."));
    case "boolean":
      return convertBoolean(value, column);
    case "date":
      return parseDate(value, column.dateFormat);
    case "dateTime":
      return parseDateTime(value, column.dateFormat);
  }
}

/** The canonical text of a value, as the ids use it. */
const canonical = (value: CellValue): string =>
  typeof value === "object" ? value.text : String(value);

/** Normalizes every data row of a CSV file according to the specification. */
export function normalize(
  spec: NormalizationSpec,
  input: string | Uint8Array,
  options: NormalizeOptions = {},
): NormalizeResult {
  const keyId = spec.hash?.keyId;
  let key: HashKey | undefined;
  if (keyId !== undefined) {
    key = options.hmacKey?.(keyId);
    if (key === undefined) {
      return {
        ok: false,
        failure: {
          kind: "hmacKeyMissing",
          message: `no HMAC key for the key id of the specification (hash.keyId)`,
        },
      };
    }
  }

  const settings: InputSettings = {
    delimiter: ",",
    quote: '"',
    encoding: "utf-8",
    headerRow: 1,
    ...spec.input,
    ...options.input,
  };
  const table = parseCsv(decodeInput(input, settings.encoding), settings).filter((cells) =>
    cells.some((cell) => cell !== ""),
  );
  const header = (table[settings.headerRow - 1] ?? []).map(canonicalText);
  const onInvalid = spec.onInvalidValue ?? "report-drop";
  const rows: NormalizedRow[] = [];
  const issues: NormalizationIssue[] = [];

  for (const [index, cells] of table.slice(settings.headerRow).entries()) {
    const rowNumber = index + 1;
    const raw = new Map(header.map((name, i) => [name, cells[i] ?? ""]));
    const row: Record<string, NormalizedValue> = { resourceType: spec.logicalModel };
    const canonicalValues = new Map<string, string>();
    let rejected = false;

    for (const column of spec.columns) {
      const cell = raw.get(column.sourceName);
      if (cell === undefined) continue;
      const value = canonicalText(cell);
      if (value === "" || (column.missingValues ?? []).includes(value)) continue;
      const parts = column.multiValue
        ? [...new Set(value.split(column.multiValue.separator).map(canonicalText))].filter(
            (part) => part !== "",
          )
        : [value];
      const converted: CellValue[] = [];
      for (const part of parts) {
        const allowed = column.allowedValues?.includes(part) ?? true;
        const result = allowed ? convert(part, column) : undefined;
        if (result !== undefined) {
          converted.push(result);
          continue;
        }
        const issue: NormalizationIssue = {
          kind: allowed ? "invalidValue" : "notAllowed",
          row: rowNumber,
          column: column.sourceName,
          value: part,
          message: allowed
            ? `row ${String(rowNumber)}, column "${column.sourceName}": the value is not a valid ${column.type}`
            : `row ${String(rowNumber)}, column "${column.sourceName}": the value is not an allowed value`,
        };
        if (onInvalid === "fail") {
          return {
            ok: false,
            failure: { ...issue, message: `${issue.message} (onInvalidValue: fail)` },
          };
        }
        issues.push(issue);
        if (onInvalid === "reject-row") rejected = true;
      }
      const [first] = converted;
      if (first === undefined) continue;
      row[column.name] = column.multiValue ? converted : first;
      canonicalValues.set(
        column.name,
        column.multiValue ? converted.map(canonical).join(",") : canonical(first),
      );
    }
    if (rejected) continue;

    for (const idField of spec.ids) {
      const values = idField.columns.map((name) => canonicalValues.get(name));
      if (values.some((value) => value === undefined)) continue;
      const id = computeId(idField, values as string[], key);
      if (!/^[A-Za-z0-9.-]{1,64}$/.test(id)) {
        issues.push({
          kind: "invalidId",
          row: rowNumber,
          idField: idField.field,
          value: id,
          message: `row ${String(rowNumber)}: the id computed for "${idField.field}" is not a valid FHIR id`,
        });
        continue;
      }
      row[idField.field] = id;
    }
    rows.push(row);
  }
  return { ok: true, rows, issues };
}
