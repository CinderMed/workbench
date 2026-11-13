/**
 * The `cindermed` command. `run` takes the arguments and the I/O as parameters, so tests drive it
 * without a process; bin.ts wires it to the real process.
 */
import { parseArgs } from "node:util";
import { exportPackage, mappingTables, toCsv, toXlsx } from "@cindermed/export";
import { type PackageRef, validateFhir } from "@cindermed/fhir-defs";
import {
  PROJECT_FORMAT_VERSION,
  type ValidationResult,
  isValid,
  parseProject,
} from "@cindermed/model";
import type { LoadedDefinitions, PackageOptions } from "./fhir-packages.js";

/** Exit codes: 0 valid, 1 the project has errors, 2 the command could not run. */
export const ExitCode = { OK: 0, INVALID: 1, USAGE: 2 } as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export interface CliIo {
  readonly readFile: (path: string) => Promise<string>;
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
  export: ["format", "out", "package-version", "created-at"],
  "mapping-table": ["format", "delimiter", "out", "created-at"],
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

Options:
  --format text|json        validate, export: output format (default: text)
  --format xlsx|csv         mapping-table: one XLSX workbook (default; use it for Excel), or one
                            CSV file per sheet in a folder
  --delimiter <char>        mapping-table, csv: field delimiter (default: ","; ";" for Excel in Italian)
  --out <file.zip|folder>   export: where to write the package (default: <name>-mapping-<version>.zip);
                            a path not ending in .zip is a folder
  --out <file.xlsx|folder>  mapping-table: where to write it (default: <name>-mapping-table.xlsx,
                            or the folder <name>-mapping-table for csv)
  --package-version <x.y.z> export: package version (default: 0.0.0-dev.<hash of the project file>)
  --created-at <date-time>  export, mapping-table: date of the package or workbook, ISO 8601 with
                            time zone (default: now)
  --no-fhir                 validate: skip the FHIR checks (paths against the FHIR definitions)
  --offline                 validate: use only the FHIR package cache, never download a package
  --fhir-cache <folder>     validate: the FHIR package cache (default: ~/.fhir/packages)
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
  // The FHIR checks need a project that passed the schema; integrity errors do not stop them.
  const status: FhirStatus = project === undefined ? "not run" : fhir.skip ? "skipped" : "done";
  let packages: string[] = [];
  if (project !== undefined && status === "done") {
    let loaded: LoadedDefinitions;
    try {
      loaded = await io.loadDefinitions(
        project.project.fhirVersion,
        (project.project.packages ?? []).map((p) => ({ id: p.name, version: p.version })),
        {
          offline: fhir.offline,
          ...(fhir.cacheDir === undefined ? {} : { cacheDir: fhir.cacheDir }),
        },
      );
    } catch (error) {
      io.stderr(
        `cindermed: cannot load the FHIR definitions for ${path}: ${error instanceof Error ? error.message : String(error)}\n` +
          "  use --fhir-cache <folder> for a cache that holds the packages, or --no-fhir to skip the FHIR checks\n",
      );
      return ExitCode.USAGE;
    }
    packages = loaded.index.manifest.packages.map((p) => `${p.id}#${p.version}`);
    results.push(...validateFhir(project, loaded.definitions));
  }
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
  const result = exportPackage(text, {
    createdAt: flags.createdAt ?? isoSecond(io.now()),
    ...(flags.packageVersion === undefined ? {} : { packageVersion: flags.packageVersion }),
    generator: { name: "cindermed", version: io.version },
  });
  if (!result.ok) {
    if (format === "json") {
      io.stdout(`${JSON.stringify({ file: path, ok: false, results: result.results }, null, 2)}\n`);
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
  if (path === undefined) return usageError(`${command} needs a project file`, io);
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

  if (command === "mapping-table") {
    const format = values.format ?? "xlsx";
    if (!(TABLE_FORMATS as readonly string[]).includes(format)) {
      return usageError(`mapping-table writes xlsx or csv, not '${format}'`, io);
    }
    const delimiter = values.delimiter;
    if (delimiter !== undefined && format !== "csv") {
      return usageError("--delimiter only applies to --format csv", io);
    }
    if (
      delimiter !== undefined &&
      (Array.from(delimiter).length !== 1 || /["\r\n]/.test(delimiter))
    ) {
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
  if (command === "validate") {
    const cacheDir = values["fhir-cache"];
    return validate(
      path,
      format,
      {
        skip: values["no-fhir"] === true,
        offline: values.offline === true,
        ...(cacheDir === undefined ? {} : { cacheDir }),
      },
      io,
    );
  }
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
      ...(flags.out === undefined ? {} : { out: flags.out }),
      ...(flags.packageVersion === undefined ? {} : { packageVersion: flags.packageVersion }),
      ...(flags.createdAt === undefined ? {} : { createdAt: flags.createdAt }),
    },
    io,
  );
}
