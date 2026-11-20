/**
 * Changes to a project, object by object (ADR-0021): the grid reads and writes a project only
 * through a store that takes these changes. Each object has its own version in the store; this
 * module is the pure part shared by every store: it applies changes to a project and keeps them
 * only when the result is schema-valid. Integrity, quality and FHIR findings never refuse a change.
 */
import type {
  Column,
  Instance,
  MappingRow,
  Project,
  ProjectFile,
  Source,
  SourceRelation,
  ValueMap,
} from "../generated/project.js";
import { validateProjectSchema } from "../schema-validation.js";
import type { ValidationResult } from "../validation-result.js";

/** The kinds of object a change addresses (the `entities` kinds of the API, plus the settings). */
export type StoredKind =
  "project" | "source" | "column" | "sourceRelation" | "instance" | "mapping" | "valueMap";

/** The value of each kind. A source is written without its columns, which are objects of their own. */
export interface ObjectValues {
  project: Project;
  source: Omit<Source, "columns">;
  column: Column;
  sourceRelation: SourceRelation;
  instance: Instance;
  mapping: MappingRow;
  valueMap: ValueMap;
}

/** The key of an object in a store: `kind/id` (the project settings: `project/<project id>`). */
export const objectKey = (kind: StoredKind, id: string): string => `${kind}/${id}`;

export type Change = {
  [K in StoredKind]:
    | {
        readonly op: "create";
        readonly kind: K;
        /** For a column: the id of its table. */
        readonly parentId?: string;
        /** A new source is created with its first columns (a table has at least one). */
        readonly value: K extends "source" ? Source : ObjectValues[K];
      }
    | {
        readonly op: "update";
        readonly kind: K;
        readonly id: string;
        readonly value: ObjectValues[K];
      }
    | { readonly op: "delete"; readonly kind: K; readonly id: string };
}[StoredKind];

/** An object a change created, updated or deleted. */
export interface Touched {
  readonly op: Change["op"];
  readonly kind: StoredKind;
  readonly id: string;
}

type FailureReason = "missing" | "exists" | "refused";

/**
 * The result of applying changes. `invalid`: the project would not match the schema (nothing is
 * kept). `missing` / `exists`: a change addresses an object that is not there, or creates one that
 * is. `refused`: a change the project cannot take, such as removing a table's last column.
 */
export type ApplyResult =
  | { readonly ok: true; readonly project: ProjectFile; readonly touched: readonly Touched[] }
  | {
      readonly ok: false;
      readonly reason: "invalid";
      readonly results: readonly ValidationResult[];
    }
  | {
      readonly ok: false;
      readonly reason: FailureReason;
      readonly kind: StoredKind;
      readonly id: string;
      readonly message: string;
    };

interface Failure {
  readonly reason: FailureReason;
  readonly message: string;
}

type Listed = "sourceRelation" | "instance" | "mapping" | "valueMap";
const COLLECTIONS = {
  sourceRelation: "sourceRelations",
  instance: "instances",
  mapping: "mappings",
  valueMap: "valueMaps",
} as const satisfies Record<Listed, keyof ProjectFile>;

/** The objects of a listed kind (a copy of the array). */
function listOf(project: ProjectFile, kind: Listed): { id: string }[] {
  return [...(project[COLLECTIONS[kind]] ?? [])];
}

/** Where a column lives: its table and position. */
function findColumn(
  project: ProjectFile,
  id: string,
): { source: Source; index: number } | undefined {
  for (const source of project.sources) {
    const index = source.columns.findIndex((c) => c.id === id);
    if (index >= 0) return { source, index };
  }
  return undefined;
}

function exists(project: ProjectFile, kind: StoredKind, id: string): boolean {
  switch (kind) {
    case "project":
      return project.project.id === id;
    case "source":
      return project.sources.some((s) => s.id === id);
    case "column":
      return findColumn(project, id) !== undefined;
    default:
      return listOf(project, kind).some((o) => o.id === id);
  }
}

const refused = (message: string): Failure => ({ reason: "refused", message });

/** Applies one change to `project` (a copy); returns why it cannot apply. */
function applyOne(project: ProjectFile, change: Change): Failure | undefined {
  const { kind, op } = change;
  const id = op === "create" ? change.value.id : change.id;
  if (op === "create" && exists(project, kind, id))
    return { reason: "exists", message: `a ${kind} with id ${id} already exists` };
  if (op !== "create" && !exists(project, kind, id))
    return { reason: "missing", message: `no ${kind} with id ${id}` };
  if (op === "update" && change.value.id !== id)
    return refused(`the id of a ${kind} cannot change`);

  if (kind === "project") {
    if (change.op !== "update") return refused("the project settings can only be updated");
    project.project = change.value;
    return undefined;
  }
  if (kind === "source") {
    if (change.op === "create") {
      project.sources.push(change.value);
      return undefined;
    }
    const index = project.sources.findIndex((s) => s.id === id);
    const current = project.sources[index];
    if (current === undefined) return { reason: "missing", message: `no source with id ${id}` };
    if (change.op === "update") {
      project.sources[index] = { ...change.value, columns: current.columns };
      return undefined;
    }
    const [first, ...others] = project.sources.filter((s) => s.id !== id);
    if (first === undefined) return refused("a project has at least one table");
    project.sources = [first, ...others];
    return undefined;
  }
  if (kind === "column") {
    if (change.op === "create") {
      const source = project.sources.find((s) => s.id === change.parentId);
      if (source === undefined)
        return { reason: "missing", message: `no table with id ${String(change.parentId)}` };
      source.columns.push(change.value);
      return undefined;
    }
    const found = findColumn(project, id);
    if (found === undefined) return { reason: "missing", message: `no column with id ${id}` };
    if (change.op === "update") {
      found.source.columns[found.index] = change.value;
      return undefined;
    }
    const [first, ...others] = found.source.columns.filter((c) => c.id !== id);
    if (first === undefined) return refused("a table has at least one column");
    found.source.columns = [first, ...others];
    return undefined;
  }
  const list = listOf(project, kind);
  if (change.op === "create") list.push(change.value);
  else if (change.op === "update") list[list.findIndex((o) => o.id === id)] = change.value;
  else
    list.splice(
      list.findIndex((o) => o.id === id),
      1,
    );
  (project as unknown as Record<string, unknown>)[COLLECTIONS[kind]] = list;
  return undefined;
}

/**
 * Applies changes in order, all or nothing: every change must address an object that exists (or,
 * for a creation, one that does not), and the project after them must match the schema
 * (`invalid`, with the schema errors, otherwise). The input project is never modified.
 */
export function applyChanges(project: ProjectFile, changes: readonly Change[]): ApplyResult {
  const next = JSON.parse(JSON.stringify(project)) as ProjectFile;
  const touched: Touched[] = [];
  for (const change of changes) {
    const id = change.op === "create" ? change.value.id : change.id;
    const failure = applyOne(next, change);
    if (failure !== undefined) return { ok: false, ...failure, kind: change.kind, id };
    touched.push({ op: change.op, kind: change.kind, id });
  }
  const results = validateProjectSchema(next);
  if (results.length > 0) return { ok: false, reason: "invalid", results };
  return { ok: true, project: next, touched };
}

/** The next free row code `R-nnn` (at least three digits). */
export function nextRowCode(project: ProjectFile): string {
  const used = project.mappings
    .map((row) => /^R-(\d+)$/.exec(row.code)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
  const next = used.length === 0 ? 1 : Math.max(...used) + 1;
  return `R-${String(next).padStart(3, "0")}`;
}
