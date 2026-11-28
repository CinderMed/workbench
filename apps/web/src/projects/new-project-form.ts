/**
 * The "New project" form (A1, #18) as plain data: what the user typed, checked, and turned into a
 * project file with the model's `newProject`. A project needs a first table with at least one
 * column (the schema), so the form asks for its name and column names, as `cindermed init`
 * takes them from a data file's header. No data values: only names.
 */
import {
  FHIR_VERSIONS,
  type FhirVersion,
  type ProjectFile,
  checkHeader,
  newProject,
} from "@cindermed/model";

export interface NewProjectDraft {
  readonly name: string;
  readonly description: string;
  readonly fhirVersion: FhirVersion;
  readonly canonicalBase: string;
  /** One package per line, `name#version` (e.g. `hl7.fhir.uv.ips#1.1.0`). */
  readonly packages: string;
  readonly table: string;
  /** The column names: one per line, or one header line separated by `,`, `;` or tabs. */
  readonly columns: string;
}

export const EMPTY_DRAFT: NewProjectDraft = {
  name: "",
  description: "",
  fhirVersion: FHIR_VERSIONS[0],
  canonicalBase: "",
  packages: "",
  table: "",
  columns: "",
};

export type DraftError =
  | { readonly field: "name" | "canonicalBase" | "table" | "columns"; readonly key: "required" }
  | { readonly field: "canonicalBase"; readonly key: "notUrl" }
  | { readonly field: "packages"; readonly key: "packageFormat"; readonly line: number }
  | { readonly field: "columns"; readonly key: "header"; readonly message: string };

/** The column names of the columns field: lines, or else the one header line split on its separator. */
export function columnNames(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length !== 1) return lines;
  const [line = ""] = lines;
  const separator = ["\t", ";", ","].find((s) => line.includes(s));
  return separator === undefined ? [line] : line.split(separator);
}

const PACKAGE = /^([a-z0-9][a-z0-9._-]*)#([0-9A-Za-z.+-]+)$/;

function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** The project of a draft, or the errors that keep it from being one. */
export function buildProject(
  draft: NewProjectDraft,
): { readonly project: ProjectFile } | { readonly errors: readonly DraftError[] } {
  const errors: DraftError[] = [];
  const name = draft.name.trim();
  const table = draft.table.trim();
  const canonicalBase = draft.canonicalBase.trim().replace(/\/+$/, "");
  if (name === "") errors.push({ field: "name", key: "required" });
  if (canonicalBase === "") errors.push({ field: "canonicalBase", key: "required" });
  else if (!isUrl(canonicalBase)) errors.push({ field: "canonicalBase", key: "notUrl" });
  if (table === "") errors.push({ field: "table", key: "required" });

  const packages: { name: string; version: string }[] = [];
  draft.packages.split(/\r?\n/).forEach((line, i) => {
    const text = line.trim();
    if (text === "") return;
    const match = PACKAGE.exec(text);
    if (match?.[1] === undefined || match[2] === undefined)
      errors.push({ field: "packages", key: "packageFormat", line: i + 1 });
    else packages.push({ name: match[1], version: match[2] });
  });

  const names = columnNames(draft.columns);
  if (names.length === 0) errors.push({ field: "columns", key: "required" });
  else
    for (const e of checkHeader(names).errors)
      errors.push({ field: "columns", key: "header", message: e.message });

  if (errors.length > 0) return { errors };
  return {
    project: newProject(checkHeader(names).names, {
      name,
      description: draft.description,
      fhirVersion: draft.fhirVersion,
      canonicalBase,
      packages,
      table,
    }),
  };
}
