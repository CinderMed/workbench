/**
 * Projects in the database (specification, "Data and persistence", #219): the `project` block in
 * `projects`, every other object a row of `entities`, the file reassembled on read. Writes go
 * through `applyChanges` (ADR-0021), so a change is kept only when the reassembled project is
 * schema-valid; integrity and FHIR findings never refuse one. Each write locks its project row,
 * so the writes to one project are serialized.
 */
import { randomBytes } from "node:crypto";
import {
  type ApplyResult,
  type Change,
  type ProjectFile,
  type StoredKind,
  applyChanges,
  objectKey,
} from "@cindermed/model";
import { type Transaction, sql } from "kysely";
import type { User } from "../auth.js";
import type { Db } from "../db/connect.js";
import type { Database, EntityKind, ProjectMeta } from "../db/schema.js";

/** A project as stored: the file and the version of every object, by `objectKey(kind, id)`. */
export interface StoredProject {
  readonly file: ProjectFile;
  readonly versions: ReadonlyMap<string, string>;
}

const ID_PREFIXES: Record<StoredKind, string> = {
  project: "prj",
  source: "src",
  column: "col",
  sourceRelation: "rel",
  instance: "ins",
  mapping: "map",
  valueMap: "vm",
};

/** A new id of the project format (`^[A-Za-z0-9_-]{6,64}$`): prefix and 16 base-36 characters. */
export function newId(kind: StoredKind): string {
  const suffix = Array.from(randomBytes(16), (b) => (b % 36).toString(36)).join("");
  return `${ID_PREFIXES[kind]}_${suffix}`;
}

/** The top-level collections of a file that hold objects of their own kind. */
const LISTED = {
  sourceRelation: "sourceRelations",
  instance: "instances",
  mapping: "mappings",
  valueMap: "valueMaps",
} as const;

type Executor = Db | Transaction<Database>;

/** The stored project, or undefined when there is none with this id. */
export async function loadProject(
  db: Executor,
  projectId: string,
): Promise<StoredProject | undefined> {
  const project = await db
    .selectFrom("projects")
    .select(["settings", "meta", "version"])
    .where("id", "=", projectId)
    .executeTakeFirst();
  if (project === undefined) return undefined;
  const rows = await db
    .selectFrom("entities")
    .select(["kind", "id", "parent_id", "version", "data"])
    .where("project_id", "=", projectId)
    .orderBy("position")
    .execute();
  const versions = new Map<string, string>([[objectKey("project", projectId), project.version]]);
  const of = (kind: EntityKind) => rows.filter((r) => r.kind === kind);
  for (const row of rows) versions.set(objectKey(row.kind, row.id), row.version);

  const columns = of("column");
  const meta = project.meta;
  const file: Record<string, unknown> = {
    ...(meta.schema === undefined ? {} : { $schema: meta.schema }),
    formatVersion: meta.formatVersion,
    project: project.settings,
    sources: of("source").map((s) => ({
      ...s.data,
      columns: columns.filter((c) => c.parent_id === s.id).map((c) => c.data),
    })),
  };
  for (const [kind, key] of Object.entries(LISTED)) {
    const items = of(kind as EntityKind).map((r) => r.data);
    if (items.length > 0 || key !== "sourceRelations" || meta.collections.includes(key))
      file[key] = items;
  }
  if (meta.templates !== undefined) file["templates"] = meta.templates;
  if (meta.extensions !== undefined) file["extensions"] = meta.extensions;
  return { file: file as unknown as ProjectFile, versions };
}

/** A table as stored: its columns are objects of their own. */
function withoutColumns(source: ProjectFile["sources"][number]): { id: string } {
  const copy: Partial<typeof source> = { ...source };
  delete copy.columns;
  return copy as { id: string };
}

/** Rows of a file's objects, in file order. */
function entityRows(projectId: string, file: ProjectFile, userId: string) {
  const rows: {
    project_id: string;
    kind: EntityKind;
    id: string;
    parent_id: string | null;
    position: number;
    data: string;
    updated_by: string;
  }[] = [];
  const push = (kind: EntityKind, value: { id: string }, position: number, parent?: string) =>
    rows.push({
      project_id: projectId,
      kind,
      id: value.id,
      parent_id: parent ?? null,
      position,
      data: JSON.stringify(value),
      updated_by: userId,
    });
  file.sources.forEach((source, i) => {
    push("source", withoutColumns(source), i);
    source.columns.forEach((column, j) => {
      push("column", column, j, source.id);
    });
  });
  for (const [kind, key] of Object.entries(LISTED))
    ((file[key] ?? []) as { id: string }[]).forEach((value, i) => {
      push(kind as EntityKind, value, i);
    });
  return rows;
}

/**
 * Stores a project file as a new project, owned by `user` (H3 import). It keeps the file's project
 * id when no project has it, and gets a new one otherwise.
 */
export async function importProject(db: Db, user: User, parsed: ProjectFile): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const taken = await trx
      .selectFrom("projects")
      .select("id")
      .where("id", "=", parsed.project.id)
      .executeTakeFirst();
    const projectId = taken === undefined ? parsed.project.id : newId("project");
    const file: ProjectFile = { ...parsed, project: { ...parsed.project, id: projectId } };
    const meta: ProjectMeta = {
      ...(file.$schema === undefined ? {} : { schema: file.$schema }),
      formatVersion: file.formatVersion,
      ...(file.templates === undefined ? {} : { templates: file.templates }),
      ...(file.extensions === undefined ? {} : { extensions: file.extensions }),
      collections: file.sourceRelations === undefined ? [] : ["sourceRelations"],
    };
    await trx
      .insertInto("projects")
      .values({
        id: projectId,
        settings: JSON.stringify(file.project),
        meta: JSON.stringify(meta),
        created_by: user.id,
      })
      .execute();
    await trx
      .insertInto("project_members")
      .values({ project_id: projectId, user_id: user.id, role: "owner" })
      .execute();
    const rows = entityRows(projectId, file, user.id);
    if (rows.length > 0) await trx.insertInto("entities").values(rows).execute();
    return projectId;
  });
}

export type WriteResult =
  | {
      readonly ok: true;
      /** The new version of every object the changes touched (deleted ones: absent). */
      readonly versions: ReadonlyMap<string, string>;
    }
  | Exclude<ApplyResult, { ok: true }>
  | { readonly ok: false; readonly reason: "noProject" };

/** Applies changes to a project, all or nothing, and stores the objects they touched. */
export async function writeChanges(
  db: Db,
  projectId: string,
  user: User,
  changes: readonly Change[],
): Promise<WriteResult> {
  return db.transaction().execute(async (trx) => {
    const locked = await trx
      .selectFrom("projects")
      .select("id")
      .where("id", "=", projectId)
      .forUpdate()
      .executeTakeFirst();
    if (locked === undefined) return { ok: false, reason: "noProject" } as const;
    const stored = await loadProject(trx, projectId);
    if (stored === undefined) return { ok: false, reason: "noProject" } as const;
    const applied = applyChanges(stored.file, changes);
    if (!applied.ok) return applied;

    const versions = new Map<string, string>();
    const now = new Date();
    for (const touched of applied.touched) {
      const key = objectKey(touched.kind, touched.id);
      if (touched.kind === "project") {
        const row = await trx
          .updateTable("projects")
          .set(() => ({
            settings: JSON.stringify(applied.project.project),
            version: sql<string>`version + 1`,
            updated_at: now,
          }))
          .where("id", "=", projectId)
          .returning("version")
          .executeTakeFirstOrThrow();
        versions.set(key, row.version);
        continue;
      }
      const kind: EntityKind = touched.kind;
      if (touched.op === "delete") {
        await trx
          .deleteFrom("entities")
          .where("project_id", "=", projectId)
          .where((eb) =>
            eb.or([
              eb.and([eb("kind", "=", kind), eb("id", "=", touched.id)]),
              // A table's columns go with it.
              ...(kind === "source"
                ? [eb.and([eb("kind", "=", "column"), eb("parent_id", "=", touched.id)])]
                : []),
            ]),
          )
          .execute();
        versions.delete(key);
        continue;
      }
      const value = objectValue(applied.project, kind, touched.id);
      if (value === undefined) continue;
      if (touched.op === "update") {
        const row = await trx
          .updateTable("entities")
          .set(() => ({
            data: JSON.stringify(value.data),
            version: sql<string>`version + 1`,
            updated_by: user.id,
            updated_at: now,
          }))
          .where("project_id", "=", projectId)
          .where("kind", "=", kind)
          .where("id", "=", touched.id)
          .returning("version")
          .executeTakeFirstOrThrow();
        versions.set(key, row.version);
        continue;
      }
      const last = await trx
        .selectFrom("entities")
        .select((eb) => eb.fn.max("position").as("max"))
        .where("project_id", "=", projectId)
        .where("kind", "=", kind)
        .where("parent_id", value.parent === null ? "is" : "=", value.parent)
        .executeTakeFirst();
      const row = await trx
        .insertInto("entities")
        .values({
          project_id: projectId,
          kind,
          id: touched.id,
          parent_id: value.parent,
          position: (last?.max ?? -1) + 1,
          data: JSON.stringify(value.data),
          updated_by: user.id,
        })
        .returning("version")
        .executeTakeFirstOrThrow();
      versions.set(key, row.version);
      // A table created with its first columns: those are rows of their own.
      if (kind === "source")
        for (const [i, column] of (
          applied.project.sources.find((s) => s.id === touched.id)?.columns ?? []
        ).entries()) {
          const created = await trx
            .insertInto("entities")
            .values({
              project_id: projectId,
              kind: "column",
              id: column.id,
              parent_id: touched.id,
              position: i,
              data: JSON.stringify(column),
              updated_by: user.id,
            })
            .returning("version")
            .executeTakeFirstOrThrow();
          versions.set(objectKey("column", column.id), created.version);
        }
    }
    return { ok: true, versions } as const;
  });
}

/** An object of the applied project as stored: its data (a table without columns) and parent. */
function objectValue(
  file: ProjectFile,
  kind: EntityKind,
  id: string,
): { data: unknown; parent: string | null } | undefined {
  if (kind === "source") {
    const source = file.sources.find((s) => s.id === id);
    if (source === undefined) return undefined;
    return { data: withoutColumns(source), parent: null };
  }
  if (kind === "column") {
    for (const source of file.sources) {
      const column = source.columns.find((c) => c.id === id);
      if (column !== undefined) return { data: column, parent: source.id };
    }
    return undefined;
  }
  const list = (file[LISTED[kind]] ?? []) as { id: string }[];
  const found = list.find((o) => o.id === id);
  return found === undefined ? undefined : { data: found, parent: null };
}
