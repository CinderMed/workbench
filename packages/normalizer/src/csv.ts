/**
 * CSV reader (RFC 4180) shared by the normalizer and, from module 5, the import wizard (ADR-0010).
 * Incremental: `CsvReader` takes the text in chunks of any size and returns the records completed
 * so far, so memory does not grow with the file. A quote, a doubled quote or a CR LF split across
 * two chunks is read as if the text were whole. `parseCsv` reads a whole text with the same
 * reader. Decoding bytes is up to `createDecoder` or the caller.
 */

export interface CsvOptions {
  /** One character; default `,`. */
  readonly delimiter?: string;
  /** One character; default `"`. A doubled quote inside a quoted field is one quote. */
  readonly quote?: string;
}

/**
 * Reading state between characters: in a field, in a quoted part, just after a quote inside a
 * quoted part (a doubled quote or the end of the quoted part, decided by the next character), or
 * just after a CR (a following LF belongs to the same line end).
 */
type State = "field" | "quoted" | "quoteInQuoted" | "afterCr";

/**
 * Splits CSV text, given in chunks, into records of fields. Line ends are `\n`, `\r\n` or `\r`; a
 * quoted part may hold delimiters, quotes and line ends, and a quote outside a quoted part starts
 * one (as in the reference normalizer). A final line without a line end is a record. Fields are
 * not trimmed, and records keep their own length.
 */
export class CsvReader {
  private readonly delimiter: string;
  private readonly quote: string;
  private state: State = "field";
  private record: string[] = [];
  private field = "";

  constructor(options: CsvOptions = {}) {
    this.delimiter = options.delimiter ?? ",";
    this.quote = options.quote ?? '"';
  }

  /** Reads one chunk and returns the records it completes. */
  push(chunk: string): string[][] {
    const records: string[][] = [];
    for (const ch of chunk) this.read(ch, records);
    return records;
  }

  /** Ends the text and returns the last record, if the text did not end with a line end. */
  end(): string[][] {
    const records: string[][] = [];
    if (this.field !== "" || this.record.length > 0) {
      this.record.push(this.field);
      records.push(this.record);
    }
    this.record = [];
    this.field = "";
    this.state = "field";
    return records;
  }

  private read(ch: string, records: string[][]): void {
    switch (this.state) {
      case "quoted":
        if (ch === this.quote) this.state = "quoteInQuoted";
        else this.field += ch;
        return;
      case "quoteInQuoted":
        if (ch === this.quote) {
          this.field += ch;
          this.state = "quoted";
          return;
        }
        this.state = "field";
        break;
      case "afterCr":
        this.state = "field";
        if (ch === "\n") return;
        break;
      case "field":
        break;
    }
    if (ch === this.quote) this.state = "quoted";
    else if (ch === this.delimiter) {
      this.record.push(this.field);
      this.field = "";
    } else if (ch === "\n" || ch === "\r") {
      this.record.push(this.field);
      records.push(this.record);
      this.record = [];
      this.field = "";
      if (ch === "\r") this.state = "afterCr";
    } else this.field += ch;
  }
}

/** Splits a whole CSV text into records (see `CsvReader`). */
export function parseCsv(text: string, options: CsvOptions = {}): string[][] {
  const reader = new CsvReader(options);
  return [...reader.push(text), ...reader.end()];
}
