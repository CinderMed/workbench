/**
 * One sheet of the mapping table as CSV (RFC 4180): UTF-8 with a byte order mark and CRLF line
 * ends, so spreadsheet programs read accented text; comma by default, or another delimiter (";"
 * for spreadsheets whose list separator is ";", such as Excel in Italian).
 *
 * Formula injection: a cell that starts with `=`, `+`, `@`, a tab or a carriage return, or with
 * `-` not followed by a digit, would run as a formula when the file is opened in a spreadsheet. It
 * is written with a leading `'`. Values such as `-1` stay as they are. XLSX needs no escaping:
 * its cells are inline strings, never formulas.
 */
import type { Sheet } from "./mapping-table.js";

export interface CsvOptions {
  /** One character; default `,`. */
  readonly delimiter?: string;
}

/** Whether a cell would be read as a formula by a spreadsheet program. */
export function looksLikeFormula(cell: string): boolean {
  return /^[=+@\t\r]/.test(cell) || /^-(?!\d)/.test(cell);
}

function field(cell: string, delimiter: string): string {
  const safe = looksLikeFormula(cell) ? `'${cell}` : cell;
  return safe.includes(delimiter) || /["\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(sheet: Sheet, options: CsvOptions = {}): string {
  const delimiter = options.delimiter ?? ",";
  if (delimiter.length !== 1 || /["\r\n]/.test(delimiter)) {
    throw new Error(
      `The CSV delimiter must be one character other than a quote or a line end: "${delimiter}"`,
    );
  }
  const lines = [sheet.header, ...sheet.rows].map((row) =>
    row.map((cell) => field(cell, delimiter)).join(delimiter),
  );
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
