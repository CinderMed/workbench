/**
 * `cindermed init` (#172): an empty project from the header of a data file. Every column is
 * `string`; there are no roles and no rows. The file is read with the normalizer's decoder and
 * CSV reader. With `--infer` the data rows are read too, only to suggest types in a separate
 * report: per column the suggested type and counts, never a cell value. Allowed values are never
 * taken from the data (they come from the dictionary, B3).
 */
import {
  type DecimalSeparator,
  type FhirVersion,
  type ProjectFile,
  canonicalText,
  checkHeader,
  newProject,
  parseBoolean,
  parseDate,
  parseDateTime,
  parseDecimal,
  parseInteger,
} from "@cindermed/model";
import { CsvReader, createDecoder, type InputSettings } from "@cindermed/normalizer";

export type Encoding = InputSettings["encoding"];
export const ENCODINGS: readonly Encoding[] = ["utf-8", "utf-8-bom", "windows-1252", "iso-8859-1"];
export { FHIR_VERSIONS, type FhirVersion, type HeaderError, checkHeader } from "@cindermed/model";
/** A finding about the file: the command writes nothing. */
export interface InitError {
  readonly message: string;
}

export interface ReadSettings {
  readonly delimiter: string;
  readonly encoding: Encoding;
  /** The header is the `headerRow`-th record that is not empty (as in the normalizer). */
  readonly headerRow: number;
}

export interface ProjectSettings {
  readonly name: string;
  readonly table: string;
  readonly fileName: string;
  readonly fhirVersion: FhirVersion;
  readonly canonicalBase: string;
  readonly read: ReadSettings;
  readonly importedAt: string;
}

/** The project: one table with the header's columns, all `string`; no roles, rows or value maps. */
export function initProject(names: readonly string[], settings: ProjectSettings): ProjectFile {
  return newProject(names, {
    name: settings.name,
    table: settings.table,
    fhirVersion: settings.fhirVersion,
    canonicalBase: settings.canonicalBase,
    imported: {
      fileName: settings.fileName,
      fileKind: "data",
      delimiter: settings.read.delimiter,
      encoding: settings.read.encoding,
      headerRow: settings.read.headerRow,
      importedAt: settings.importedAt,
    },
  });
}

/** A type a column could have, with the format it needs. */
export interface Candidate {
  readonly dataType: "integer" | "decimal" | "boolean" | "date" | "dateTime";
  readonly decimalSeparator?: DecimalSeparator;
  readonly dateFormat?: string;
}

/**
 * The types tried, most specific first. Dates are tried in ISO and in day-first forms (Italian
 * sources); month-first forms are not tried, because `03/04/2024` would be ambiguous.
 */
export const CANDIDATES: readonly Candidate[] = [
  { dataType: "integer" },
  { dataType: "decimal", decimalSeparator: "." },
  { dataType: "decimal", decimalSeparator: "," },
  { dataType: "boolean" },
  { dataType: "date", dateFormat: "yyyy-MM-dd" },
  { dataType: "date", dateFormat: "dd/MM/yyyy" },
  { dataType: "date", dateFormat: "dd-MM-yyyy" },
  { dataType: "date", dateFormat: "dd.MM.yyyy" },
  { dataType: "dateTime", dateFormat: "yyyy-MM-ddTHH:mm:ss" },
  { dataType: "dateTime", dateFormat: "yyyy-MM-dd HH:mm:ss" },
  { dataType: "dateTime", dateFormat: "dd/MM/yyyy HH:mm:ss" },
  { dataType: "dateTime", dateFormat: "dd/MM/yyyy HH:mm" },
];

function converts(candidate: Candidate, text: string): boolean {
  switch (candidate.dataType) {
    case "integer":
      return parseInteger(text) !== undefined;
    case "decimal":
      return parseDecimal(text, candidate.decimalSeparator) !== undefined;
    case "boolean":
      return parseBoolean(text) !== undefined;
    case "date":
      return parseDate(text, candidate.dateFormat)?.length === 10;
    case "dateTime":
      return parseDateTime(text, candidate.dateFormat)?.length === 19;
  }
}

/** The type report of `--infer`: counts only, no cell values. */
export interface TypeReport {
  readonly fileName: string;
  readonly rowsRead: number;
  /** Data rows whose number of cells differs from the header's. */
  readonly rowsWithOtherCellCount: number;
  readonly columns: readonly ColumnReport[];
}

export interface ColumnReport {
  readonly position: number;
  readonly name: string;
  readonly emptyCells: number;
  /** The most specific candidate every non-empty cell converts to; `string` otherwise. */
  readonly suggested: { readonly dataType: Candidate["dataType"] | "string" } & Omit<
    Candidate,
    "dataType"
  >;
  /** Every candidate with the number of non-empty cells that do not convert to it. */
  readonly candidates: readonly (Candidate & { readonly cellsNotConverting: number })[];
}

/** Counts, column by column, the cells that convert to each candidate; keeps no cell value. */
export class TypeCounter {
  private rows = 0;
  private otherCount = 0;
  private readonly empty: number[];
  private readonly failures: number[][];
  private readonly names: readonly string[];

  constructor(names: readonly string[]) {
    this.names = names;
    this.empty = names.map(() => 0);
    this.failures = names.map(() => CANDIDATES.map(() => 0));
  }

  add(record: readonly string[]): void {
    this.rows += 1;
    if (record.length !== this.names.length) this.otherCount += 1;
    this.names.forEach((_, column) => {
      const text = canonicalText(record[column] ?? "");
      if (text === "") {
        this.empty[column] = (this.empty[column] ?? 0) + 1;
        return;
      }
      const failures = this.failures[column];
      if (failures === undefined) return;
      CANDIDATES.forEach((candidate, i) => {
        if (!converts(candidate, text)) failures[i] = (failures[i] ?? 0) + 1;
      });
    });
  }

  report(fileName: string): TypeReport {
    return {
      fileName,
      rowsRead: this.rows,
      rowsWithOtherCellCount: this.otherCount,
      columns: this.names.map((name, column) => {
        const emptyCells = this.empty[column] ?? 0;
        const failures = this.failures[column] ?? [];
        const candidates = CANDIDATES.map((candidate, i) => ({
          ...candidate,
          cellsNotConverting: failures[i] ?? 0,
        }));
        const filled = this.rows - emptyCells;
        const fit = filled > 0 ? candidates.find((c) => c.cellsNotConverting === 0) : undefined;
        const suggested: ColumnReport["suggested"] =
          fit === undefined
            ? { dataType: "string" }
            : {
                dataType: fit.dataType,
                ...(fit.decimalSeparator === undefined
                  ? {}
                  : { decimalSeparator: fit.decimalSeparator }),
                ...(fit.dateFormat === undefined ? {} : { dateFormat: fit.dateFormat }),
              };
        return { position: column + 1, name, emptyCells, suggested, candidates };
      }),
    };
  }
}

/** What reading the data file gives: the header, and the type report when asked for. */
export type ReadResult =
  | { readonly ok: true; readonly names: string[]; readonly report?: TypeReport }
  | { readonly ok: false; readonly errors: InitError[] };

/**
 * Reads a data file in chunks: the header only, or (with `infer`) every data row, counted by
 * `TypeCounter`. Records with only empty cells are skipped and not counted, as in the normalizer.
 */
export async function readDataFile(
  chunks: AsyncIterable<Uint8Array>,
  settings: ReadSettings,
  options: { readonly infer: boolean; readonly fileName: string },
): Promise<ReadResult> {
  const decoder = createDecoder(settings.encoding);
  const reader = new CsvReader({ delimiter: settings.delimiter });
  let seen = 0;
  let names: string[] | undefined;
  let counter: TypeCounter | undefined;
  let errors: InitError[] = [];
  const take = (records: string[][]): boolean => {
    for (const record of records) {
      if (record.every((cell) => cell.trim() === "")) continue;
      if (names === undefined) {
        seen += 1;
        if (seen < settings.headerRow) continue;
        const checked = checkHeader(record);
        names = checked.names;
        // The CLI names its own option in the encoding hint.
        errors = checked.errors.map((e) =>
          e.code === "encoding"
            ? {
                ...e,
                message:
                  "the header has characters that are not valid in the encoding: give the file's encoding with --encoding (Italian files are often windows-1252)",
              }
            : e,
        );
        if (errors.length > 0 || !options.infer) return true;
        counter = new TypeCounter(names);
        continue;
      }
      counter?.add(record);
    }
    return false;
  };
  for await (const chunk of chunks) if (take(reader.push(decoder.push(chunk)))) break;
  if (names === undefined || counter !== undefined)
    take([...reader.push(decoder.end()), ...reader.end()]);
  if (errors.length > 0) return { ok: false, errors };
  if (names === undefined)
    return {
      ok: false,
      errors: [
        {
          message:
            seen === 0
              ? "the file has no records"
              : `the file has ${String(seen)} non-empty records, so there is no header at row ${String(settings.headerRow)}`,
        },
      ],
    };
  return counter === undefined
    ? { ok: true, names }
    : { ok: true, names, report: counter.report(options.fileName) };
}
