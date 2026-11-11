/**
 * Text of the normalized rows, byte for byte as the reference normalizer writes it: two-space
 * JSON, one row as an object and any other number of rows as an array, a final newline. Integers
 * and decimals are JSON numbers written with their canonical digits (`11.20`, 20-digit integers):
 * this is the only place where a `NumberText` becomes a number.
 */
import type { CellValue, NormalizedRow, NormalizedValue } from "./normalize.js";

function cell(value: CellValue): string {
  return typeof value === "object" ? value.text : JSON.stringify(value);
}

function element(value: NormalizedValue, indent: string): string {
  if (!Array.isArray(value)) return cell(value as CellValue);
  const items = value as readonly CellValue[];
  if (items.length === 0) return "[]";
  const inner = `${indent}  `;
  return `[\n${items.map((item) => `${inner}${cell(item)}`).join(",\n")}\n${indent}]`;
}

function row(value: NormalizedRow, indent: string): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  const inner = `${indent}  `;
  const lines = entries.map(
    ([name, item]) => `${inner}${JSON.stringify(name)}: ${element(item, inner)}`,
  );
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

/** Serializes normalized rows as the reference normalizer does. */
export function serializeRows(rows: readonly NormalizedRow[]): string {
  const [only] = rows;
  if (rows.length === 1 && only !== undefined) return `${row(only, "")}\n`;
  if (rows.length === 0) return "[]\n";
  return `[\n${rows.map((item) => `  ${row(item, "  ")}`).join(",\n")}\n]\n`;
}
