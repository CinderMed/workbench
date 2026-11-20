/**
 * The local implementation of `ProjectStore` (ADR-0021): one project file on the developer's
 * machine, kept in memory. Every accepted change rewrites the whole file when the file can be
 * written; otherwise the store keeps the change and marks the project unsaved, for a download.
 * Versions are counters in memory, from "1" when the file is loaded; they are never written to the
 * file. Nothing goes to browser storage.
 */
import {
  type ProjectFile,
  type StoredKind,
  type ValidationResult,
  applyChanges,
  objectKey,
  parseProject,
  serializeProject,
} from "@cindermed/model";
import { type FileAccess, FileChangedError } from "./file-access";
import {
  type Loaded,
  type ProjectStore,
  type StoreChange,
  type StoreResult,
  objectKeys,
} from "./project-store";

/** The file is not a project: not JSON, another format, or not schema-valid. */
export class NotAProjectError extends Error {
  readonly results: readonly ValidationResult[];
  constructor(name: string, results: readonly ValidationResult[]) {
    super(`${name} is not a valid project file`);
    this.name = "NotAProjectError";
    this.results = results;
  }
}

const PREFIXES: Record<StoredKind, string> = {
  project: "prj",
  source: "src",
  column: "col",
  sourceRelation: "rel",
  instance: "ins",
  mapping: "map",
  valueMap: "vm",
};

export class LocalFileStore implements ProjectStore {
  private project: ProjectFile | undefined;
  private versions = new Map<string, string>();
  private unsaved = false;
  /** The format the file had, when it was migrated on loading. */
  migratedFrom: string | undefined;

  private readonly access: FileAccess;
  private readonly random: () => string;

  constructor(access: FileAccess, random: () => string = randomSuffix) {
    this.access = access;
    this.random = random;
  }

  get fileName(): string {
    return this.access.name;
  }

  /** Whether changes are kept only in memory (the file can only be downloaded). */
  get hasUnsavedChanges(): boolean {
    return this.unsaved;
  }

  get canWriteFile(): boolean {
    return this.access.write !== undefined;
  }

  async load(): Promise<Loaded> {
    const parsed = parseProject(await this.access.read());
    if (parsed.project === undefined) throw new NotAProjectError(this.access.name, parsed.results);
    this.project = parsed.project;
    this.migratedFrom = parsed.migratedFrom;
    this.versions = new Map(objectKeys(parsed.project).map((key) => [key, "1"]));
    this.unsaved = false;
    return this.current();
  }

  async apply(changes: readonly StoreChange[]): Promise<StoreResult> {
    if (this.project === undefined) throw new Error("load the project first");
    const stale = changes
      .filter((c) => c.op !== "create")
      .map((c) => ({ key: objectKey(c.kind, c.id), read: c.readVersion }))
      .filter(({ key, read }) => read !== undefined && this.versions.get(key) !== read)
      .map(({ key }) => key);
    if (stale.length > 0)
      return { ok: false, reason: "conflict", keys: stale, current: this.current() };

    const applied = applyChanges(this.project, changes);
    if (!applied.ok) return applied;
    if (this.access.write !== undefined) {
      try {
        await this.access.write(serializeProject(applied.project));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return error instanceof FileChangedError
          ? { ok: false, reason: "fileChanged", message }
          : { ok: false, reason: "writeFailed", message };
      }
    } else this.unsaved = true;

    this.project = applied.project;
    for (const { op, kind, id } of applied.touched) {
      const key = objectKey(kind, id);
      if (op === "delete") this.versions.delete(key);
      else this.versions.set(key, String(Number(this.versions.get(key) ?? "0") + 1));
    }
    return { ok: true, ...this.current() };
  }

  newId(kind: StoredKind): string {
    return `${PREFIXES[kind]}_${this.random()}`;
  }

  /** The text to download, and the project marked as saved. */
  download(): { readonly name: string; readonly text: string } {
    if (this.project === undefined) throw new Error("load the project first");
    this.unsaved = false;
    return { name: this.access.name, text: serializeProject(this.project) };
  }

  private current(): Loaded {
    if (this.project === undefined) throw new Error("load the project first");
    return { project: this.project, versions: new Map(this.versions) };
  }
}

/** Ten random base-36 characters (Web Crypto), for ids of the project format. */
function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}
