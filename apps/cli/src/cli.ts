/**
 * The `cindermed` command. `run` takes the arguments and the I/O as parameters, so tests drive it
 * without a process; bin.ts wires it to the real process.
 */
import { parseArgs } from "node:util";
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
}

const FORMATS = ["text", "json"] as const;
type Format = (typeof FORMATS)[number];

export const USAGE = `Usage: cindermed <command> [options]

Commands:
  validate <project.json>   Check a project file (schema and integrity rules)

Options:
  --format text|json        Output format of validate (default: text)
  -h, --help                Show this help

Exit codes: 0 valid, 1 the project has errors, 2 the command could not run.
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

async function validate(path: string, format: Format, io: CliIo): Promise<ExitCode> {
  let text: string;
  try {
    text = await io.readFile(path);
  } catch (error) {
    const code =
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "read error";
    io.stderr(`cindermed: cannot read ${path} (${code})\n`);
    return ExitCode.USAGE;
  }

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

function usageError(message: string, io: CliIo): ExitCode {
  io.stderr(`cindermed: ${message}\n\n${USAGE}`);
  return ExitCode.USAGE;
}

function parseCommandLine(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    options: {
      format: { type: "string", default: "text" },
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
  if (command !== "validate") return usageError(`unknown command '${command}'`, io);
  if (!isFormat(values.format)) return usageError(`unknown format '${values.format}'`, io);
  const [path, ...rest] = operands;
  if (path === undefined) return usageError("validate needs a project file", io);
  if (rest.length > 0) return usageError(`unexpected argument '${rest.join(" ")}'`, io);
  return validate(path, values.format, io);
}
