/**
 * The storage interface of the grid (ADR-0021). The grid reads and writes a project only through a
 * `ProjectStore`: it loads the project, then sends changes object by object. Every object has its
 * own version; an update or a delete carries the version it read and conflicts only when that
 * object changed since. `LocalFileStore` implements it now, an API store in module 4.
 */
import {
  type ApplyResult,
  type Change,
  type ProjectFile,
  type StoredKind,
  objectKey,
} from "@cindermed/model";

/** A change with the version of the object it read (updates and deletes). */
export type StoreChange = Change & { readonly readVersion?: string };

/** The project and the version of every object, by `objectKey(kind, id)`. */
export interface Loaded {
  readonly project: ProjectFile;
  readonly versions: ReadonlyMap<string, string>;
}

export type StoreResult =
  | ({ readonly ok: true } & Loaded)
  | Exclude<ApplyResult, { ok: true }>
  | {
      readonly ok: false;
      readonly reason: "conflict";
      /** The objects that changed since they were read, with the current project and versions. */
      readonly keys: readonly string[];
      readonly current: Loaded;
    }
  | {
      readonly ok: false;
      /** `fileChanged`: the file changed outside the app since it was last read or written. */
      readonly reason: "writeFailed" | "fileChanged";
      readonly message: string;
    };

export interface ProjectStore {
  load(): Promise<Loaded>;
  /** Applies one change, or a batch (all or nothing). */
  apply(changes: readonly StoreChange[]): Promise<StoreResult>;
  /**
   * A new id for an object of this kind (the server assigns them in module 4). A slice is part of
   * its role, not an object of its own, but has an id like one.
   */
  newId(kind: IdKind): string;
}

/** The kinds of object that get an id: the stored kinds, and the slices inside a role. */
export type IdKind = StoredKind | "slice";

/** Every object of a project with its key, for the initial versions. */
export function objectKeys(project: ProjectFile): string[] {
  return [
    objectKey("project", project.project.id),
    ...project.sources.flatMap((s) => [
      objectKey("source", s.id),
      ...s.columns.map((c) => objectKey("column", c.id)),
    ]),
    ...(project.sourceRelations ?? []).map((r) => objectKey("sourceRelation", r.id)),
    ...project.instances.map((i) => objectKey("instance", i.id)),
    ...project.mappings.map((m) => objectKey("mapping", m.id)),
    ...project.valueMaps.map((v) => objectKey("valueMap", v.id)),
  ];
}
