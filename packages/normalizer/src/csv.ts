/**
 * CSV reader (RFC 4180) shared by the normalizer and, from module 5, the import wizard (ADR-0010).
 * Pure function on text: decoding the file is up to `decodeInput` or the caller.
 */

export interface CsvOptions {
  /** One character; default `,`. */
  readonly delimiter?: string;
  /** One character; default `"`. A doubled quote inside a quoted field is one quote. */
  readonly quote?: string;
}

/**
 * Splits CSV text into rows of fields. Line ends are `\n`, `\r\n` or `\r`; a quoted field may hold
 * delimiters, quotes and line ends. A final line without a line end is a row. Fields are not
 * trimmed, and rows keep their own length.
 */
export function parseCsv(text: string, options: CsvOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ",";
  const quote = options.quote ?? '"';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch !== quote) field += ch;
      else if (text.charAt(i + 1) === quote) {
        field += ch;
        i++;
      } else quoted = false;
    } else if (ch === quote) quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text.charAt(i + 1) === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
