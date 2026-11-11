/**
 * Format version handling of the project file (specification, "Format version"; ADR-0006).
 *
 * - Same major and minor, any patch: read as it is.
 * - Same major, older minor: compatible; read as it is and stamped with the current version.
 * - Older major: the migrations in the registry run one major at a time.
 * - Newer minor or major: the file may contain fields this version does not know, so it is
 *   rejected.
 */
import { PROJECT_FORMAT_VERSION } from "../schemas.js";
import type { ValidationResult } from "../validation-result.js";
import { ProjectFileCode } from "./codes.js";

/** Turns a document of format `fromMajor`.x into one of format (`fromMajor` + 1).0.0. */
export interface Migration {
  readonly fromMajor: number;
  readonly migrate: (document: Readonly<Record<string, unknown>>) => Record<string, unknown>;
}

/** Registered migrations. Empty while the project format is at major 1. */
export const PROJECT_MIGRATIONS: readonly Migration[] = [];

interface Version {
  readonly major: number;
  readonly minor: number;
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseVersion(text: string): Version | undefined {
  const match = SEMVER.exec(text);
  if (match === null) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/** Compares major and minor only: patches never change what a file may contain. */
function compare(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor;
}

function current(): Version {
  const version = parseVersion(PROJECT_FORMAT_VERSION);
  if (version === undefined)
    throw new Error(`Invalid PROJECT_FORMAT_VERSION ${PROJECT_FORMAT_VERSION}`);
  return version;
}

export interface MigrationOutcome {
  /** The document to validate: migrated when needed, otherwise the input itself. */
  readonly document: unknown;
  /** The version the file had, when it was older than the current one. */
  readonly migratedFrom?: string;
  readonly results: ValidationResult[];
}

function unsupported(formatVersion: string, reason: string): ValidationResult {
  return {
    severity: "error",
    code: ProjectFileCode.UNSUPPORTED_FORMAT_VERSION,
    objectKind: "project",
    field: "formatVersion",
    message: `Format version ${formatVersion} ${reason}; this version reads ${PROJECT_FORMAT_VERSION}.`,
  };
}

/**
 * Brings a parsed project file to the current format version. A document without a readable
 * `formatVersion` is returned unchanged: the schema check reports it.
 */
export function migrateProject(
  document: unknown,
  migrations: readonly Migration[] = PROJECT_MIGRATIONS,
): MigrationOutcome {
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    return { document, results: [] };
  }
  const record = document as Readonly<Record<string, unknown>>;
  const formatVersion = record["formatVersion"];
  const version = typeof formatVersion === "string" ? parseVersion(formatVersion) : undefined;
  if (typeof formatVersion !== "string" || version === undefined) return { document, results: [] };

  const target = current();
  const order = compare(version, target);
  if (order === 0) return { document, results: [] };
  if (order > 0) {
    return {
      document,
      results: [unsupported(formatVersion, "is newer than this version of CinderMed")],
    };
  }

  let migrated: Record<string, unknown> = { ...record };
  for (let major = version.major; major < target.major; major++) {
    const migration = migrations.find((candidate) => candidate.fromMajor === major);
    if (migration === undefined) {
      return {
        document,
        results: [unsupported(formatVersion, `has no migration from ${String(major)}.x`)],
      };
    }
    migrated = migration.migrate(migrated);
  }
  migrated["formatVersion"] = PROJECT_FORMAT_VERSION;
  return { document: migrated, migratedFrom: formatVersion, results: [] };
}
