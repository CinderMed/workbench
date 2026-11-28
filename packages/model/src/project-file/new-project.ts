/**
 * A new project from the names of its first table's columns (ADR-0022): used by `cindermed init`
 * on a data file's header and by the web app's "New project" form (A1, #18). Every column is
 * `string`; there are no roles, rows or value maps. Moved from the CLI to the model when the web
 * app needed it, as ADR-0022 planned. Pure: reading the data file stays with each caller.
 */
import type { Column, ImportProfile, ProjectFile } from "../generated/project.js";
import { PROJECT_FORMAT_VERSION } from "../schemas.js";
import { canonicalText } from "../values/index.js";

export const FHIR_VERSIONS = ["4.0.1", "5.0.0"] as const;
export type FhirVersion = (typeof FHIR_VERSIONS)[number];

/** A finding about a header: no project is made from it. */
export interface HeaderError {
  /** `encoding`: bytes not valid in the file's encoding; `empty` or `duplicate`: a column name. */
  readonly code: "encoding" | "empty" | "duplicate";
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
      code: "encoding",
      message:
        "the header has characters that are not valid in the encoding: give the file's encoding (Italian files are often windows-1252)",
    });
  const seen = new Map<string, number>();
  names.forEach((name, i) => {
    const position = i + 1;
    if (name === "") {
      errors.push({ code: "empty", message: `column ${String(position)} has an empty header` });
      return;
    }
    const first = seen.get(name);
    if (first === undefined) seen.set(name, position);
    else
      errors.push({
        code: "duplicate",
        message: `columns ${String(first)} and ${String(position)} have the same header '${name}'`,
      });
  });
  return { names, errors };
}

/** The text without leading and trailing `_`, in linear time (no backtracking pattern). */
function trimUnderscores(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === "_") start += 1;
  while (end > start && text[end - 1] === "_") end -= 1;
  return text.slice(start, end);
}

/** An id of the project format (`[A-Za-z0-9_-]{6,64}`) from a prefix and a name. */
export function idFrom(prefix: string, name: string, fallback: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_");
  const slug = trimUnderscores(cleaned);
  const id = `${prefix}${slug === "" ? fallback : slug}`.slice(0, 64);
  return id.length >= 6 ? id : `${id}_${fallback}`.slice(0, 64);
}

/** Column ids `col_<name>`, unique, with the position as a fallback for names with no letters. */
export function columnIds(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name, i) => {
    const base = idFrom("col_", name, String(i + 1).padStart(3, "0"));
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base.slice(0, 60)}_${String(n)}`;
    used.add(id);
    return id;
  });
}

export interface NewProjectSettings {
  readonly name: string;
  readonly description?: string;
  readonly fhirVersion: FhirVersion;
  readonly canonicalBase: string;
  /** IG and profile packages besides the core (A1). */
  readonly packages?: readonly { readonly name: string; readonly version: string }[];
  /** The first table's name. */
  readonly table: string;
  /** How the table was read from a data file, when it was (`sources[].import`). */
  readonly imported?: ImportProfile;
}

/** The project: one table with the given columns, all `string`; no roles, rows or value maps. */
export function newProject(names: readonly string[], settings: NewProjectSettings): ProjectFile {
  const ids = columnIds(names);
  const columns = names.map((name, i): Column => ({
    id: ids[i] ?? `col_${String(i + 1)}`,
    name,
    dataType: "string",
  }));
  const [first, ...rest] = columns;
  if (first === undefined) throw new Error("a table has at least one column");
  const description = settings.description?.trim();
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    project: {
      id: idFrom("prj_", settings.name.toLowerCase(), "project"),
      name: settings.name,
      ...(description === undefined || description === "" ? {} : { description }),
      fhirVersion: settings.fhirVersion,
      ...(settings.packages === undefined || settings.packages.length === 0
        ? {}
        : { packages: settings.packages.map((p) => ({ name: p.name, version: p.version })) }),
      canonicalBase: settings.canonicalBase,
    },
    sources: [
      {
        id: idFrom("src_", settings.table.toLowerCase(), "table"),
        name: settings.table,
        ...(settings.imported === undefined ? {} : { import: settings.imported }),
        columns: [first, ...rest],
      },
    ],
    instances: [],
    mappings: [],
    valueMaps: [],
  };
}
