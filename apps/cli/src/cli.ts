/**
 * The `cindermed` command. `run` takes the arguments and the I/O as parameters, so tests drive it
 * without a process; bin.ts wires it to the real process.
 */
import { parseArgs } from "node:util";
import { exportPackage } from "@cindermed/export";
import {
  PROJECT_FORMAT_VERSION,
  type ValidationResult,
  isValid,
  parseProject,
} from "@cindermed/model";

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
}

const FORMATS = ["text", "json"] as const;
type Format = (typeof FORMATS)[number];

export const USAGE = `Usage: cindermed <command> [options]

Commands:
  validate <project.json>   Check a project file (schema, integrity and quality rules)
  export <project.json>     Write the export package (maps, logical models, normalization
                            specifications, ConceptMaps, schemas, manifest)

Options:
  --format text|json        Output format (default: text)
  --out <file.zip|folder>   export: where to write the package (default: <name>-mapping-<version>.zip);
                            a path not ending in .zip is a folder
  --package-version <x.y.z> export: package version (default: 0.0.0-dev.<hash of the project file>)
  --created-at <date-time>  export: package date, ISO 8601 with time zone (default: now)
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

async function validate(path: string, format: Format, io: CliIo): Promise<ExitCode> {
  const text = await readProject(path, io);
  if (text === undefined) return ExitCode.USAGE;

  const parsed = parseProject(text);
  const valid = isValid(parsed.results);

  if (format === "json") {
    const report = {
      file: path,
      valid,
      formatVersion: parsed.project?.formatVersion,
      migratedFrom: parsed.migratedFrom,
      results: parsed.results,
    };
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const errors = parsed.results.filter((result) => result.severity === "error").length;
    const warnings = parsed.results.length - errors;
    const summary = valid
      ? `valid (format ${parsed.project?.formatVersion ?? PROJECT_FORMAT_VERSION})`
      : plural(errors, "error");
    const extra = warnings > 0 ? `, ${plural(warnings, "warning")}` : "";
    const lines = [`${path}: ${summary}${extra}`];
    if (parsed.migratedFrom !== undefined) {
      lines.push(
        `  note: read as format ${PROJECT_FORMAT_VERSION} (file has ${parsed.migratedFrom})`,
      );
    }
    lines.push(...parsed.results.map(describeResult));
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

function usageError(message: string, io: CliIo): ExitCode {
  io.stderr(`cindermed: ${message}\n\n${USAGE}`);
  return ExitCode.USAGE;
}

function parseCommandLine(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    options: {
      format: { type: "string", default: "text" },
      out: { type: "string" },
      "package-version": { type: "string" },
      "created-at": { type: "string" },
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
  if (command !== "validate" && command !== "export") {
    return usageError(`unknown command '${command}'`, io);
  }
  if (!isFormat(values.format)) return usageError(`unknown format '${values.format}'`, io);
  const [path, ...rest] = operands;
  if (path === undefined) return usageError(`${command} needs a project file`, io);
  if (rest.length > 0) return usageError(`unexpected argument '${rest.join(" ")}'`, io);
  const flags = {
    out: values.out,
    packageVersion: values["package-version"],
    createdAt: values["created-at"],
  };
  if (command === "validate") {
    const used = Object.entries({
      out: flags.out,
      "package-version": flags.packageVersion,
      "created-at": flags.createdAt,
    })
      .filter(([, value]) => value !== undefined)
      .map(([key]) => `--${key}`);
    if (used.length > 0) return usageError(`${used.join(", ")} only applies to export`, io);
    return validate(path, values.format, io);
  }
  if (flags.packageVersion !== undefined && !SEMVER.test(flags.packageVersion)) {
    return usageError(
      `--package-version must be a version such as 1.2.0, not '${flags.packageVersion}'`,
      io,
    );
  }
  if (flags.createdAt !== undefined && !DATE_TIME.test(flags.createdAt)) {
    return usageError(
      `--created-at must be an ISO 8601 date-time with a time zone, not '${flags.createdAt}'`,
      io,
    );
  }
  return exportProject(
    path,
    values.format,
    {
      ...(flags.out === undefined ? {} : { out: flags.out }),
      ...(flags.packageVersion === undefined ? {} : { packageVersion: flags.packageVersion }),
      ...(flags.createdAt === undefined ? {} : { createdAt: flags.createdAt }),
    },
    io,
  );
}
