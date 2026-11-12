/**
 * The copy of the project file inside the export package (ADR-0012). The package goes to whoever
 * runs the conversion, so it carries what the mapping means, not how the team worked on it: the
 * full file stays the H3 project export.
 *
 * Removed, at any depth: `review` (status and comments, with their authors and dates),
 * `provenance` (who or what created an object, `acceptedBy`), the `verification` of Codings
 * (terminology check status, `checkedAt`, `serverDisplay`); at the top: `extensions` (data of
 * external tools); in `project`: `createdAt` and `updatedAt`. Everything else stays, descriptions
 * and labels included, so the generator gives the same artifacts from the cleaned copy.
 */
import type { ProjectFile } from "@cindermed/model";

/** Keys removed wherever they appear. */
export const REMOVED_KEYS: readonly string[] = ["review", "provenance", "verification"];
/** Keys removed from the top level and from `project`. */
export const REMOVED_TOP_KEYS: readonly string[] = ["extensions"];
export const REMOVED_PROJECT_KEYS: readonly string[] = ["createdAt", "updatedAt"];

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !REMOVED_KEYS.includes(key))
      .map(([key, item]) => [key, strip(item)]),
  );
}

const without = (
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

/** The cleaned copy of a project (a new object; the input is not changed). */
export function cleanProject(project: ProjectFile): ProjectFile {
  const cleaned = without(strip(project) as Record<string, unknown>, REMOVED_TOP_KEYS);
  const settings = without(cleaned["project"] as Record<string, unknown>, REMOVED_PROJECT_KEYS);
  return { ...cleaned, project: settings } as unknown as ProjectFile;
}
