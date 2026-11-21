/**
 * The `cindermed` command. `run` takes the arguments and the I/O as parameters, so tests drive it
 * without a process; bin.ts wires it to the real process.
 */
import { parseArgs } from "node:util";
import { exportPackage, mappingTables, toCsv, toXlsx } from "@cindermed/export";
import { type PackageRef, validateFhir } from "@cindermed/fhir-defs";
import {
  PROJECT_FORMAT_VERSION,
  type ProjectFile,
  type ValidationResult,
  isValid,
  parseProject,
} from "@cindermed/model";
import type { LoadedDefinitions, PackageOptions } from "./fhir-packages.js";
import {
  ENCODINGS,
  type Encoding,
  FHIR_VERSIONS,
  type FhirVersion,
  initProject,
  readDataFile,
} from "./init.js";

/** Exit codes: 0 valid, 1 the project has errors, 2 the command could not run. */
export const ExitCode = { OK: 0, INVALID: 1, USAGE: 2 } as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export interface CliIo {
  readonly readFile: (path: string) => Promise<string>;
  /** Reads a file as bytes, chunk by chunk (init: a data file of any size). */
  readonly readChunks: (path: string) => AsyncIterable<Uint8Array>;
  /** Whether a file exists (init never overwrites one). */
  readonly exists: (path: string) => Promise<boolean>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Writes a file, creating its folders. */
  readonly writeFile: (path: string, data: Uint8Array) => Promise<void>;
  /** The clock, for the default `createdAt` of an export. */
  readonly now: () => Date;
  /** Version of the cindermed CLI, written as the generator of exported packages. */
  readonly version: string;
  /** Loads the FHIR definitions of a FHIR version and packages (bin.ts: `loadDefinitions`). */
  readonly loadDefinitions: (
    fhirVersion: string,
    packages: readonly PackageRef[],
    options: PackageOptions,
  ) => Promise<LoadedDefinitions>;
}

const FORMATS = ["text", "json"] as const;
type Format = (typeof FORMATS)[number];
const TABLE_FORMATS = ["csv", "xlsx"] as const;
type TableFormat = (typeof TABLE_FORMATS)[number];

/** Options each command accepts (besides --help). */
const COMMAND_OPTIONS = {
  validate: ["format", "no-fhir", "offline", "fhir-cache"],
  // No --no-fhir: the export always needs the FHIR definitions (ADR-0023).
  export: ["format", "out", "package-version", "created-at", "offline", "fhir-cache"],
  "mapping-table": ["format", "delimiter", "out", "created-at"],
  "fhir-index": ["out", "offline", "fhir-cache"],
  init: [
    "out",
    "name",
    "table",
    "fhir-version",
    "canonical-base",
    "delimiter",
    "encoding",
    "header-row",
    "infer",
  ],
} as const;
type Command = keyof typeof COMMAND_OPTIONS;

function isCommand(value: string): value is Command {
  return Object.hasOwn(COMMAND_OPTIONS, value);
}

export const USAGE = `Usage: cindermed <command> [options]

Commands:
  validate <project.json>   Check a project file (schema, integrity, FHIR and quality rules)
  export <project.json>     Write the export package (maps, logical models, normalization
                            specifications, ConceptMaps, schemas, manifest)
  mapping-table <project.json>
                            Write the mapping table for documentation and review (sheets
                            Mapping, Value maps, Roles, Columns)
  fhir-index <project.json> Write the compact FHIR definition index of the project's FHIR version
                            and packages into a folder (--out), for the web app's local mode
  init <data.csv>           Write an empty project from a data file's header: one table, every
                            column string, no roles and no rows (needs --fhir-version and
                            --canonical-base)

Options:
  --format text|json        validate, export: output format (default: text)
  --format xlsx|csv         mapping-table: one XLSX workbook (default; use it for Excel), or one
                            CSV file per sheet in a folder
  --delimiter <char>        mapping-table, csv: field delimiter (default: ","; ";" for Excel in Italian)
                            init: the data file's delimiter (default: ",")
  --encoding <name>         init: utf-8 (default), utf-8-bom, windows-1252 or iso-8859-1
  --header-row <n>          init: the header is the n-th non-empty record (default: 1)
  --fhir-version <v>        init: 4.0.1 or 5.0.0
  --canonical-base <url>    init: base of the project's canonical URLs
  --name <name>             init: project name (default: the table name)
  --table <name>            init: table name (default: the file name without its extension)
  --infer                   init: also read the data rows and write a type report next to the
                            project (<out>.types.json): suggested types and counts only, no
                            values; the project's columns stay string
  --out <file.zip|folder>   export: where to write the package (default: <name>-mapping-<version>.zip);
                            a path not ending in .zip is a folder
  --out <file.xlsx|folder>  mapping-table: where to write it (default: <name>-mapping-table.xlsx,
                            or the folder <name>-mapping-table for csv)
  --out <folder>            fhir-index: the folder to write the index into (required; for the
                            local mode: apps/web/.fhir-index)
  --out <project.json>      init: where to write the project (default: <table>.project.json);
                            an existing file is never overwritten
  --package-version <x.y.z> export: package version (default: 0.0.0-dev.<hash of the project file>)
  --created-at <date-time>  export, mapping-table: date of the package or workbook, ISO 8601 with
                            time zone (default: now)
  --no-fhir                 validate: skip the FHIR checks (paths and types against the FHIR
                            definitions); export always needs them
  --offline                 validate, export, fhir-index: use only the FHIR package cache, never download
  --fhir-cache <folder>     validate, export, fhir-index: the FHIR package cache (default: ~/.fhir/packages)
  -h, --help                Show this help

Exit codes: 0 done, 1 the project has errors (nothing is written), 2 the command could not run.
`;

function isFormat(value: string): value is Format {
  return (FORMATS as readonly string[]).includes(value);
}

function describeResult(result: ValidationResult): string {
  const target = [result.objectKind, result.id].filter((part) => part !== undefined).join(" ");
  const field = result.field === undefined ? "" : ` (${result.field})`;
  return `  ${result.severity} ${result.code} ${target}${field}: ${result.message}`;
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

function errorCode(error: unknown, fallback: string): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : fallback;
}

async function readProject(path: string, io: CliIo): Promise<string | undefined> {
  try {
    return await io.readFile(path);
  } catch (error) {
    io.stderr(`cindermed: cannot read ${path} (${errorCode(error, "read error")})\n`);
    return undefined;
  }
}

export interface FhirFlags {
  /** `--no-fhir`: skip the FHIR checks. */
  readonly skip: boolean;
  readonly offline: boolean;
  readonly cacheDir?: string;
}

type FhirStatus = "done" | "skipped" | "not run";

interface FhirLoad {
  readonly status: FhirStatus;
  readonly packages: readonly string[];
  readonly loaded?: LoadedDefinitions;
}

/**
 * The FHIR definitions for a project: loaded (core package and `project.packages`), skipped
 * (`--no-fhir`) or not needed (the project did not pass the schema). `undefined` when they could
 * not be loaded: the message is written and the command stops with exit code 2.
 */
async function definitionsFor(
  path: string,
  project: ProjectFile | undefined,
  fhir: FhirFlags,
  io: CliIo,
  command: "validate" | "export",
): Promise<FhirLoad | undefined> {
  if (project === undefined) return { status: "not run", packages: [] };
  if (fhir.skip) return { status: "skipped", packages: [] };
  try {
    const loaded = await io.loadDefinitions(
      project.project.fhirVersion,
      (project.project.packages ?? []).map((p) => ({ id: p.name, version: p.version })),
      {
        offline: fhir.offline,
        ...(fhir.cacheDir === undefined ? {} : { cacheDir: fhir.cacheDir }),
      },
    );
    return {
      status: "done",
      packages: loaded.index.manifest.packages.map((p) => `${p.id}#${p.version}`),
      loaded,
    };
  } catch (error) {
    io.stderr(
      `cindermed: cannot load the FHIR definitions for ${path}: ${error instanceof Error ? error.message : String(error)}\n` +
        (command === "export"
          ? "  use --fhir-cache <folder> for a cache that holds the packages: the export always needs the FHIR definitions\n"
          : "  use --fhir-cache <folder> for a cache that holds the packages, or --no-fhir to skip the FHIR checks\n"),
    );
    return undefined;
  }
}

async function validate(
  path: string,
  format: Format,
  fhir: FhirFlags,
  io: CliIo,
): Promise<ExitCode> {
  const text = await readProject(path, io);
  if (text === undefined) return ExitCode.USAGE;

  const parsed = parseProject(text);
  const results: ValidationResult[] = [...parsed.results];
  const project = parsed.project;
  const fhirLoad = await definitionsFor(path, project, fhir, io, "validate");
  if (fhirLoad === undefined) return ExitCode.USAGE;
  if (project !== undefined && fhirLoad.loaded !== undefined)
    results.push(...validateFhir(project, fhirLoad.loaded.definitions));
  const { status, packages } = fhirLoad;
  const valid = isValid(results);

  if (format === "json") {
    const report = {
      file: path,
      valid,
      formatVersion: project?.formatVersion,
      migratedFrom: parsed.migratedFrom,
      fhir: { checks: status, packages },
      results,
    };
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const errors = results.filter((result) => result.severity === "error").length;
    const warnings = results.length - errors;
    const summary = valid
      ? `valid (format ${project?.formatVersion ?? PROJECT_FORMAT_VERSION})`
      : plural(errors, "error");
    const extra = warnings > 0 ? `, ${plural(warnings, "warning")}` : "";
    const lines = [`${path}: ${summary}${extra}`];
    if (parsed.migratedFrom !== undefined) {
      lines.push(
        `  note: read as format ${PROJECT_FORMAT_VERSION} (file has ${parsed.migratedFrom})`,
      );
    }
    if (status === "skipped") lines.push("  note: FHIR checks skipped (--no-fhir)");
    lines.push(...results.map(describeResult));
    io.stdout(`${lines.join("\n")}\n`);
  }
  return valid ? ExitCode.OK : ExitCode.INVALID;
}

export interface ExportFlags {
  readonly fhir: FhirFlags;
  readonly out?: string;
  readonly packageVersion?: string;
  readonly createdAt?: string;
}

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** `now` as ISO 8601 in UTC, to the second. */
const isoSecond = (date: Date): string => `${date.toISOString().slice(0, 19)}Z`;

async function exportProject(
  path: string,
  format: Format,
  flags: ExportFlags,
  io: CliIo,
): Promise<ExitCode> {
  const text = await readProject(path, io);
  if (text === undefined) return ExitCode.USAGE;
  const parsed = parseProject(text);
  const fhirLoad = await definitionsFor(path, parsed.project, flags.fhir, io, "export");
  if (fhirLoad === undefined) return ExitCode.USAGE;
  const fhir = { checks: fhirLoad.status, packages: fhirLoad.packages };
  // Without definitions the project did not pass the schema: blocked by those results.
  const result =
    fhirLoad.loaded === undefined
      ? { ok: false as const, results: parsed.results }
      : exportPackage(text, {
          definitions: fhirLoad.loaded.definitions,
          createdAt: flags.createdAt ?? isoSecond(io.now()),
          ...(flags.packageVersion === undefined ? {} : { packageVersion: flags.packageVersion }),
          generator: { name: "cindermed", version: io.version },
        });
  if (!result.ok) {
    if (format === "json") {
      io.stdout(
        `${JSON.stringify({ file: path, ok: false, fhir, results: result.results }, null, 2)}\n`,
      );
    } else {
      const errors = result.results.filter((r) => r.severity === "error").length;
      const lines = [`${path}: export blocked, ${plural(errors, "error")}`];
      lines.push(...result.results.map(describeResult));
      io.stdout(`${lines.join("\n")}\n`);
    }
    return ExitCode.INVALID;
  }

  const { name, version } = result.manifest.package;
  const out = flags.out ?? `${name}-${version}.zip`;
  const asZip = out.endsWith(".zip");
  try {
    if (asZip) await io.writeFile(out, result.zip);
    else {
      for (const [file, bytes] of [...result.files].sort(([a], [b]) => a.localeCompare(b))) {
        await io.writeFile(`${out.replace(/\/+$/, "")}/${file}`, bytes);
      }
    }
  } catch (error) {
    io.stderr(`cindermed: cannot write ${out} (${errorCode(error, "write error")})\n`);
    return ExitCode.USAGE;
  }

  const files = [...result.files.keys()].sort();
  if (format === "json") {
    const report = {
      file: path,
      ok: true,
      out,
      package: result.manifest.package,
      files,
      fhir,
      warnings: result.warnings,
    };
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const extra =
      result.warnings.length > 0 ? `, ${plural(result.warnings.length, "warning")}` : "";
    const lines = [
      `${path}: exported ${name} ${version} to ${out} (${plural(files.length, "file")}${extra})`,
      ...result.warnings.map(describeResult),
    ];
    io.stdout(`${lines.join("\n")}\n`);
  }
  return ExitCode.OK;
}

const TABLE_FILES: Readonly<Record<string, string>> = {
  Mapping: "mapping.csv",
  "Value maps": "value-maps.csv",
  Roles: "roles.csv",
  Columns: "columns.csv",
};

async function mappingTable(
  path: string,
  format: TableFormat,
  flags: { readonly out?: string; readonly delimiter?: string; readonly createdAt?: string },
  io: CliIo,
): Promise<ExitCode> {
  const text = await readProject(path, io);
  if (text === undefined) return ExitCode.USAGE;
  const parsed = parseProject(text);
  if (parsed.project === undefined) {
    const lines = [`${path}: not written, ${plural(parsed.results.length, "error")}`];
    lines.push(...parsed.results.map(describeResult));
    io.stdout(`${lines.join("\n")}\n`);
    return ExitCode.INVALID;
  }
  const sheets = mappingTables(parsed.project);
  const base = `${parsed.project.project.name.toLowerCase()}-mapping-table`;
  const out = flags.out ?? (format === "xlsx" ? `${base}.xlsx` : base);
  const encoder = new TextEncoder();
  try {
    if (format === "xlsx") {
      await io.writeFile(
        out,
        toXlsx(sheets, { createdAt: flags.createdAt ?? isoSecond(io.now()) }),
      );
    } else {
      for (const sheet of sheets) {
        const csv = toCsv(
          sheet,
          flags.delimiter === undefined ? {} : { delimiter: flags.delimiter },
        );
        await io.writeFile(
          `${out.replace(/\/+$/, "")}/${TABLE_FILES[sheet.name] ?? `${sheet.name}.csv`}`,
          encoder.encode(csv),
        );
      }
    }
  } catch (error) {
    io.stderr(`cindermed: cannot write ${out} (${errorCode(error, "write error")})\n`);
    return ExitCode.USAGE;
  }
  const lines = sheets.map((sheet) => `${String(sheet.rows.length).padStart(5)} ${sheet.name}`);
  const findings =
    parsed.results.length === 0
      ? []
      : [
          `  note: written although the project has ${plural(parsed.results.length, "finding")}:`,
          ...parsed.results.map(describeResult),
        ];
  io.stdout(
    `${[`${path}: wrote the mapping table to ${out}`, ...lines, ...findings].join("\n")}\n`,
  );
  return ExitCode.OK;
}

/** A delimiter is one character other than a quote or a line end. */
function badDelimiter(delimiter: string): boolean {
  return Array.from(delimiter).length !== 1 || /["\r\n]/.test(delimiter);
}

type Values = ReturnType<typeof parseCommandLine>["values"];

/** `cindermed init`: an empty project from a data file's header (and a type report, --infer). */
async function init(path: string, values: Values, io: CliIo): Promise<ExitCode> {
  const fhirVersion = values["fhir-version"];
  if (fhirVersion === undefined || !(FHIR_VERSIONS as readonly string[]).includes(fhirVersion))
    return usageError(`init needs --fhir-version ${FHIR_VERSIONS.join(" or ")}`, io);
  const canonicalBase = values["canonical-base"];
  if (canonicalBase === undefined) return usageError("init needs --canonical-base <url>", io);
  const delimiter = values.delimiter ?? ",";
  if (badDelimiter(delimiter))
    return usageError(
      `--delimiter must be one character other than a quote or a line end, not '${delimiter}'`,
      io,
    );
  const encoding = values.encoding ?? "utf-8";
  if (!(ENCODINGS as readonly string[]).includes(encoding))
    return usageError(`--encoding must be ${ENCODINGS.join(", ")}, not '${encoding}'`, io);
  const headerText = values["header-row"] ?? "1";
  const headerRow = /^[1-9]\d*$/.test(headerText) ? Number(headerText) : undefined;
  if (headerRow === undefined)
    return usageError(`--header-row must be a whole number from 1, not '${headerText}'`, io);

  const fileName = path.replace(/^.*[\\/]/, "");
  const table = values.table ?? fileName.replace(/\.[^.]*$/, "");
  const out = values.out ?? `${table}.project.json`;
  const reportPath = `${out.replace(/\.json$/i, "")}.types.json`;
  const infer = values.infer === true;
  for (const target of infer ? [out, reportPath] : [out])
    if (await io.exists(target)) {
      io.stderr(`cindermed: ${target} already exists: remove it or choose another --out\n`);
      return ExitCode.USAGE;
    }

  const read = { delimiter, encoding: encoding as Encoding, headerRow };
  let result: Awaited<ReturnType<typeof readDataFile>>;
  try {
    result = await readDataFile(io.readChunks(path), read, { infer, fileName });
  } catch (error) {
    io.stderr(`cindermed: cannot read ${path} (${errorCode(error, "read error")})\n`);
    return ExitCode.USAGE;
  }
  if (!result.ok) {
    const lines = [`${path}: no project written, ${plural(result.errors.length, "error")}`];
    lines.push(...result.errors.map((e) => `  error: ${e.message}`));
    io.stdout(`${lines.join("\n")}\n`);
    return ExitCode.INVALID;
  }
  const project = initProject(result.names, {
    name: values.name ?? table,
    table,
    fileName,
    fhirVersion: fhirVersion as FhirVersion,
    canonicalBase,
    read,
    importedAt: isoSecond(io.now()),
  });
  const parsed = parseProject(JSON.stringify(project));
  if (parsed.project === undefined) {
    const lines = [`${path}: no project written, ${plural(parsed.results.length, "error")}`];
    lines.push(...parsed.results.map(describeResult));
    io.stdout(`${lines.join("\n")}\n`);
    return ExitCode.USAGE;
  }
  const encoder = new TextEncoder();
  try {
    await io.writeFile(out, encoder.encode(`${JSON.stringify(project, null, 2)}\n`));
    if (result.report !== undefined)
      await io.writeFile(reportPath, encoder.encode(`${JSON.stringify(result.report, null, 2)}\n`));
  } catch (error) {
    io.stderr(`cindermed: cannot write ${out} (${errorCode(error, "write error")})\n`);
    return ExitCode.USAGE;
  }
  const lines = [
    `${path}: wrote ${out}: table ${table}, ${plural(result.names.length, "column")}, all string`,
  ];
  if (result.report !== undefined) {
    lines.push(
      `  type report ${reportPath}: ${plural(result.report.rowsRead, "row")} read; suggested types (the project is unchanged):`,
    );
    for (const column of result.report.columns) {
      const s = column.suggested;
      const format =
        s.dateFormat !== undefined
          ? ` ${s.dateFormat}`
          : s.decimalSeparator !== undefined
            ? ` separator '${s.decimalSeparator}'`
            : "";
      lines.push(
        `    ${column.name}: ${s.dataType}${format} (${plural(column.emptyCells, "empty cell")})`,
      );
    }
    if (result.report.rowsWithOtherCellCount > 0)
      lines.push(
        `  note: ${plural(result.report.rowsWithOtherCellCount, "row")} with a number of cells other than the header's`,
      );
  }
  io.stdout(`${lines.join("\n")}\n`);
  return ExitCode.OK;
}

/** A path inside the index (`types/Patient.json`): relative, without `..`, a JSON file. */
const INDEX_PATH = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._#-]+(?:\/[A-Za-z0-9._#-]+)*\.json$/;

/** `cindermed fhir-index`: the compact definition index of a project's FHIR version and packages. */
async function fhirIndex(path: string, out: string, fhir: FhirFlags, io: CliIo): Promise<ExitCode> {
  const text = await readProject(path, io);
  if (text === undefined) return ExitCode.USAGE;
  const parsed = parseProject(text);
  if (parsed.project === undefined) {
    const lines = [`${path}: no index written, ${plural(parsed.results.length, "error")}`];
    lines.push(...parsed.results.map(describeResult));
    io.stdout(`${lines.join("\n")}\n`);
    return ExitCode.INVALID;
  }
  const load = await definitionsFor(path, parsed.project, fhir, io, "validate");
  if (load?.loaded === undefined) return ExitCode.USAGE;
  const { index } = load.loaded;
  const files: [string, string][] = [["index.json", index.manifestText], ...index.files];
  const unsafe = files.find(([file]) => !INDEX_PATH.test(file));
  if (unsafe !== undefined) {
    io.stderr(`cindermed: the index has a file name that cannot be written safely: ${unsafe[0]}\n`);
    return ExitCode.USAGE;
  }
  const folder = out.replace(/\/+$/, "");
  const encoder = new TextEncoder();
  try {
    for (const [file, content] of files)
      await io.writeFile(`${folder}/${file}`, encoder.encode(content));
  } catch (error) {
    io.stderr(`cindermed: cannot write ${folder} (${errorCode(error, "write error")})\n`);
    return ExitCode.USAGE;
  }
  io.stdout(
    `${path}: wrote the FHIR ${parsed.project.project.fhirVersion} definition index to ${folder} (${plural(files.length - 1, "document")}; ${load.packages.join(", ")})\n`,
  );
  return ExitCode.OK;
}

function usageError(message: string, io: CliIo): ExitCode {
  io.stderr(`cindermed: ${message}\n\n${USAGE}`);
  return ExitCode.USAGE;
}

function parseCommandLine(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    options: {
      format: { type: "string" },
      delimiter: { type: "string" },
      out: { type: "string" },
      "package-version": { type: "string" },
      "created-at": { type: "string" },
      "no-fhir": { type: "boolean" },
      offline: { type: "boolean" },
      "fhir-cache": { type: "string" },
      name: { type: "string" },
      table: { type: "string" },
      "fhir-version": { type: "string" },
      "canonical-base": { type: "string" },
      encoding: { type: "string" },
      "header-row": { type: "string" },
      infer: { type: "boolean" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });
}

/** Runs the command line `args` (without the node and script paths) and returns the exit code. */
export async function run(args: readonly string[], io: CliIo): Promise<ExitCode> {
  let parsed: ReturnType<typeof parseCommandLine>;
  try {
    parsed = parseCommandLine(args);
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error), io);
  }

  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(USAGE);
    return ExitCode.OK;
  }
  const [command, ...operands] = positionals;
  if (command === undefined) return usageError("missing command", io);
  if (!isCommand(command)) return usageError(`unknown command '${command}'`, io);
  const [path, ...rest] = operands;
  if (path === undefined)
    return usageError(`${command} needs a ${command === "init" ? "data" : "project"} file`, io);
  if (rest.length > 0) return usageError(`unexpected argument '${rest.join(" ")}'`, io);
  const given = Object.entries(values)
    .filter(([key]) => key !== "help")
    .map(([key]) => key);
  const allowed: readonly string[] = COMMAND_OPTIONS[command];
  const foreign = given.filter((key) => !allowed.includes(key)).map((key) => `--${key}`);
  if (foreign.length > 0) {
    return usageError(`${foreign.join(", ")} does not apply to ${command}`, io);
  }
  const flags = {
    out: values.out,
    packageVersion: values["package-version"],
    createdAt: values["created-at"],
  };
  if (flags.createdAt !== undefined && !DATE_TIME.test(flags.createdAt)) {
    return usageError(
      `--created-at must be an ISO 8601 date-time with a time zone, not '${flags.createdAt}'`,
      io,
    );
  }

  if (command === "init") return init(path, values, io);
  if (command === "fhir-index") {
    if (values.out === undefined) return usageError("fhir-index needs --out <folder>", io);
    const cacheDir = values["fhir-cache"];
    return fhirIndex(
      path,
      values.out,
      {
        skip: false,
        offline: values.offline === true,
        ...(cacheDir === undefined ? {} : { cacheDir }),
      },
      io,
    );
  }

  if (command === "mapping-table") {
    const format = values.format ?? "xlsx";
    if (!(TABLE_FORMATS as readonly string[]).includes(format)) {
      return usageError(`mapping-table writes xlsx or csv, not '${format}'`, io);
    }
    const delimiter = values.delimiter;
    if (delimiter !== undefined && format !== "csv") {
      return usageError("--delimiter only applies to --format csv", io);
    }
    if (delimiter !== undefined && badDelimiter(delimiter)) {
      return usageError(
        `--delimiter must be one character other than a quote or a line end, not '${delimiter}'`,
        io,
      );
    }
    return mappingTable(
      path,
      format as TableFormat,
      {
        ...(flags.out === undefined ? {} : { out: flags.out }),
        ...(delimiter === undefined ? {} : { delimiter }),
        ...(flags.createdAt === undefined ? {} : { createdAt: flags.createdAt }),
      },
      io,
    );
  }

  const format = values.format ?? "text";
  if (!isFormat(format)) return usageError(`unknown format '${format}'`, io);
  const cacheDir = values["fhir-cache"];
  const fhirFlags: FhirFlags = {
    skip: values["no-fhir"] === true,
    offline: values.offline === true,
    ...(cacheDir === undefined ? {} : { cacheDir }),
  };
  if (command === "validate") return validate(path, format, fhirFlags, io);
  if (flags.packageVersion !== undefined && !SEMVER.test(flags.packageVersion)) {
    return usageError(
      `--package-version must be a version such as 1.2.0, not '${flags.packageVersion}'`,
      io,
    );
  }
  return exportProject(
    path,
    format,
    {
      fhir: fhirFlags,
      ...(flags.out === undefined ? {} : { out: flags.out }),
      ...(flags.packageVersion === undefined ? {} : { packageVersion: flags.packageVersion }),
      ...(flags.createdAt === undefined ? {} : { createdAt: flags.createdAt }),
    },
    io,
  );
}
