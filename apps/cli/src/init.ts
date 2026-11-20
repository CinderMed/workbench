/**
 * `cindermed init` (#172): an empty project from the header of a data file. Every column is
 * `string`; there are no roles and no rows. The file is read with the normalizer's decoder and
 * CSV reader. With `--infer` the data rows are read too, only to suggest types in a separate
 * report: per column the suggested type and counts, never a cell value. Allowed values are never
 * taken from the data (they come from the dictionary, B3).
 */
import {
  type Column,
  type DecimalSeparator,
  PROJECT_FORMAT_VERSION,
  type ProjectFile,
  canonicalText,
  parseBoolean,
  parseDate,
  parseDateTime,
  parseDecimal,
  parseInteger,
} from "@cindermed/model";
import { CsvReader, createDecoder, type InputSettings } from "@cindermed/normalizer";

export type Encoding = InputSettings["encoding"];
export const ENCODINGS: readonly Encoding[] = ["utf-8", "utf-8-bom", "windows-1252", "iso-8859-1"];
export const FHIR_VERSIONS = ["4.0.1", "5.0.0"] as const;
export type FhirVersion = (typeof FHIR_VERSIONS)[number];

export interface ReadSettings {
  readonly delimiter: string;
  readonly encoding: Encoding;
  /** The header is the `headerRow`-th record that is not empty (as in the normalizer). */
  readonly headerRow: number;
}

/** A finding about the header: the command writes nothing. */
export interface HeaderError {
  readonly message: string;
}

/**
 * The column names of a header record: Unicode NFC, trimmed (as in the normalizer). Empty or
 * duplicate names are errors, with the column positions (1-based).
 */
export function checkHeader(record: readonly string[]): { names: string[]; errors: HeaderError[] } {
  const names = record.map(canonicalText);
  const errors: HeaderError[] = [];
  if (names.some((name) => name.includes("�")))
    errors.push({
      message:
        "the header has characters that are not valid in the encoding: give the file's encoding with --encoding (Italian files are often windows-1252)",
    });
  const seen = new Map<string, number>();
  names.forEach((name, i) => {
    const position = i + 1;
    if (name === "") {
      errors.push({ message: `column ${String(position)} has an empty header` });
      return;
    }
    const first = seen.get(name);
    if (first === undefined) seen.set(name, position);
    else
      errors.push({
        message: `columns ${String(first)} and ${String(position)} have the same header '${name}'`,
      });
  });
  return { names, errors };
}

/** An id of the project format (`[A-Za-z0-9_-]{6,64}`) from a prefix and a name. */
function idFrom(prefix: string, name: string, fallback: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const id = `${prefix}${slug === "" ? fallback : slug}`.slice(0, 64);
  return id.length >= 6 ? id : `${id}_${fallback}`.slice(0, 64);
}

/** Column ids `col_<name>`, unique, with the position as a fallback for names with no letters. */
function columnIds(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name, i) => {
    const base = idFrom("col_", name, String(i + 1).padStart(3, "0"));
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base.slice(0, 60)}_${String(n)}`;
    used.add(id);
    return id;
  });
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
  const ids = columnIds(names);
  const columns = names.map((name, i): Column => ({
    id: ids[i] ?? `col_${String(i + 1)}`,
    name,
    dataType: "string",
  }));
  const [first, ...rest] = columns;
  if (first === undefined) throw new Error("a header has at least one column");
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    project: {
      id: idFrom("prj_", settings.name.toLowerCase(), "project"),
      name: settings.name,
      fhirVersion: settings.fhirVersion,
      canonicalBase: settings.canonicalBase,
    },
    sources: [
      {
        id: idFrom("src_", settings.table.toLowerCase(), "table"),
        name: settings.table,
        import: {
          fileName: settings.fileName,
          fileKind: "data",
          delimiter: settings.read.delimiter,
          encoding: settings.read.encoding,
          headerRow: settings.read.headerRow,
          importedAt: settings.importedAt,
        },
        columns: [first, ...rest],
      },
    ],
    instances: [],
    mappings: [],
    valueMaps: [],
  };
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
  | { readonly ok: false; readonly errors: HeaderError[] };

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
  let errors: HeaderError[] = [];
  const take = (records: string[][]): boolean => {
    for (const record of records) {
      if (record.every((cell) => cell.trim() === "")) continue;
      if (names === undefined) {
        seen += 1;
        if (seen < settings.headerRow) continue;
        const checked = checkHeader(record);
        names = checked.names;
        errors = checked.errors;
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
