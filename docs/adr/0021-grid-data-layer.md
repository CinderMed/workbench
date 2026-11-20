# ADR-0021: Grid data layer and local mode

- Status: accepted
- Date: 2026-11-20
- Module: 7 (mapping grid, local mode)

## Context

Module 7 builds the mapping grid before the API, the database and the login (module 4). In this module the grid works on a project file on the developer's machine. In module 4 the same grid works on the API, where several users edit one project at the same time. The API is built around objects (`entities` by kind, each with a version, `If-Match`, 409 on conflict; specification, "Persistence" and "REST API"). If the grid saved the whole project with one version, two users editing different rows would conflict on every save. So the interface has to be built around objects from the start, even though the local implementation has one user.

The plan for module 7 was approved on 2026-11-20 with these requirements: an object-level interface; a save is refused only when the result would not be schema-valid; local mode bound to localhost, without login, opening project files only and storing no cell values in the browser.

## Decision

### 1. Storage interface, built around objects

The grid reads and writes a project only through one interface, `ProjectStore`. No grid component reads or writes a file, the browser storage or the API directly.

```ts
type ObjectKind =
  | "project" // project settings: the `project` block (one object)
  | "source" // a table, without its columns
  | "column" // a column, inside its table (parent: the source id)
  | "sourceRelation"
  | "instance" // a role
  | "mapping" // a row
  | "valueMap";

interface StoredObject<T> {
  kind: ObjectKind;
  id: string;
  version: string;
  value: T;
}

type Change =
  | { op: "create"; kind: ObjectKind; parentId?: string; value: unknown }
  | { op: "update"; kind: ObjectKind; id: string; readVersion: string; value: unknown }
  | { op: "delete"; kind: ObjectKind; id: string; readVersion: string };

type ChangeResult =
  | { ok: true; objects: StoredObject<unknown>[] } // new versions
  | { ok: false; reason: "conflict"; current: StoredObject<unknown>[] }
  | { ok: false; reason: "invalid"; results: ValidationResult[] }; // schema only

interface ProjectStore {
  load(): Promise<{ project: ProjectFile; versions: Map<string, string> }>; // key: `${kind}/${id}`
  apply(changes: readonly Change[]): Promise<ChangeResult>; // one change, or a batch (D8)
}
```

- **Versions are per object.** An update or a delete carries the version that was read. It conflicts only when that same object has changed since; changes to other objects never conflict. A batch (bulk actions, D8) is all or nothing.
- **Ids and row codes** of new objects are assigned by the store: by the server in module 4 (`POST /entities/{kind}`), by the local implementation now. The local store gives schema-valid ids and the next free `R-nnn` code.
- **The pure part is shared.** The `Change` types and `applyChanges(project, changes)`, which returns the new project or the schema results, live in `@cindermed/model` (no I/O, ADR-0001). The local store and the tests use it; the API can use it in module 4 to check a change before writing it.
- **Implementations live in `apps/web`** (`src/storage/`): `LocalFileStore` now, `ApiStore` in module 4 (`GET /entities?kind=…` to load, `PUT`/`DELETE` with `If-Match`, `POST` to create, `entities:batch` for batches, `PATCH /projects/{p}` for settings).
- **No contract change.** Versions are not written into the project file; the project format stays 1.4.0.

### 2. Save rules

- A change is refused only when the project after the change would not be **schema-valid** (`reason: "invalid"`, with the schema results). Nothing is written and the grid keeps the user's input in the cell, with the message.
- **Integrity, quality and FHIR findings never block a save.** They are shown in the grid (inline validation, D7) and block the export, as in the CLI. Work in progress can be saved: for example a row whose role has just been deleted is saved, and shown with the integrity error, until the user fixes it.
- A file written by `cindermed init` (tables and columns, no roles and no rows) is schema-valid, so a new project can be saved from its first change.

### 3. Local mode

- **Localhost only.** The local mode runs only in the Vite dev server, bound to `127.0.0.1` with `strictPort`. A test fails if the configuration binds any other address. The production build (and so the Docker image) does not contain `LocalFileStore`: the store is chosen at build time, and the production build uses only `ApiStore`. There is no login in local mode, so it must never run on an address other people can reach. Vite's host check stays on: `server.allowedHosts` is never `true`, and the same test checks it.
- **Project files only.** The web app opens project files only (`.json`, checked with `parseProject`), never data files. Data files are read only by the CLI (`cindermed init`, the normalizer), which writes no cell values into the project.
- **No cell values in the browser.** The project is kept in memory only. Nothing is copied to `localStorage`, `sessionStorage` or IndexedDB. Closing the tab with unsaved changes asks for confirmation.
- **Writing the file.** `LocalFileStore` rewrites the whole file after each accepted change:
  - where the File System Access API exists (Chromium browsers), on the file that was opened. Before each write it compares the file's last-modified time with the one it last wrote; if the file changed outside the app, the write is refused and the user is asked to reload it;
  - elsewhere, the project stays in memory and is saved with an explicit download.
- **Local versions** are counters kept in memory, starting at 1 when the file is loaded.

### 4. FHIR definitions in local mode

The browser uses the compact definition index (ADR-0013), never whole packages. In local mode the CLI builds it for the project's FHIR version and packages (from the shared cache `~/.fhir/packages`) into `apps/web/.fhir-index/` (git-ignored). A dev-server plugin (`apply: "serve"`) serves that folder under `/fhir-index/`, on localhost only; it is not part of the production build. In module 4 the API serves the same index.

### 5. Validation in the browser

The grid runs the same checks as the CLI (`validateProject` from `@cindermed/model`, `validateFhir` from `@cindermed/fhir-defs`) in a Web Worker after each accepted change. Results colour the cells through their `objectKind`, `id` and `field`. A new change cancels a run still in progress (the worker run is aborted, or its results are dropped by their change number), so results of an older project never colour the cells.

## Consequences

- Module 4 only adds `ApiStore`; the grid does not change. Conflicts show the current object next to the user's (A3).
- The local mode has one user, so local conflicts happen only through the file changing on disk.
- Browsers without the File System Access API need an explicit download to save. This is accepted for a developer tool.
- The local mode remains a developer tool after module 4: it is available only in `vite dev`.
