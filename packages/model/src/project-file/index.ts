/**
 * The JSON project file (H3): read, validate and write it. Pure functions on strings and values;
 * reading and writing the file itself is up to the caller (ADR-0001).
 */
import type { ProjectFile } from "../generated/project.js";
import { checkIntegrity } from "../integrity/index.js";
import { checkQuality } from "../quality/index.js";
import { validateProjectSchema } from "../schema-validation.js";
import { projectSchema } from "../schemas.js";
import type { ValidationResult } from "../validation-result.js";
import { ProjectFileCode } from "./codes.js";
import { orderKeys } from "./key-order.js";
import { type Migration, PROJECT_MIGRATIONS, migrateProject } from "./migrations.js";

export { ProjectFileCode } from "./codes.js";
export {
  type Migration,
  type MigrationOutcome,
  PROJECT_MIGRATIONS,
  migrateProject,
} from "./migrations.js";

/**
 * Schema, integrity and quality levels of project validation. Integrity and quality run only on
 * a document that passed the schema, because they rely on its shape. Quality results are warnings.
 */
export function validateProject(document: unknown): ValidationResult[] {
  const schemaResults = validateProjectSchema(document);
  if (schemaResults.length > 0) return schemaResults;
  return checkProject(document as ProjectFile);
}

/** Integrity errors, then quality warnings. */
function checkProject(project: ProjectFile): ValidationResult[] {
  return [...checkIntegrity(project), ...checkQuality(project)];
}

export interface ParsedProject {
  /** The project, present when it matches the schema (it may still have integrity errors). */
  readonly project?: ProjectFile;
  /** The format version of the file, when it was migrated to the current one. */
  readonly migratedFrom?: string;
  readonly results: ValidationResult[];
}

/** Parses the text of a project file, migrates it to the current format and validates it. */
export function parseProject(
  text: string,
  migrations: readonly Migration[] = PROJECT_MIGRATIONS,
): ParsedProject {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      results: [
        {
          severity: "error",
          code: ProjectFileCode.INVALID_JSON,
          objectKind: "project",
          message: `The project file is not valid JSON: ${reason}`,
        },
      ],
    };
  }

  const outcome = migrateProject(document, migrations);
  if (outcome.results.length > 0) return { results: outcome.results };
  const migrated = outcome.migratedFrom === undefined ? {} : { migratedFrom: outcome.migratedFrom };

  const schemaResults = validateProjectSchema(outcome.document);
  if (schemaResults.length > 0) return { ...migrated, results: schemaResults };
  const project = outcome.document as ProjectFile;
  return { ...migrated, project, results: checkProject(project) };
}

/**
 * Writes a project file: canonical key order (schema order, ADR-0006), two-space indentation and
 * a final newline, so the same project always gives the same text and git diffs stay small.
 */
export function serializeProject(project: ProjectFile): string {
  return `${JSON.stringify(orderKeys(project, projectSchema), null, 2)}\n`;
}
