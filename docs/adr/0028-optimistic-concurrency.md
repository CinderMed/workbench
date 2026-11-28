# ADR-0028: Optimistic concurrency with If-Match, and batches in one transaction

- Status: accepted
- Date: 2026-11-28
- Module: 4 (Platform)
- Issue: #20

## Context

Several users edit one project (A3): "if two users edit the same row, the second sees the conflict and chooses which version to keep". The specification fixes the mechanism: "every write carries the version that was read (`If-Match`); if it changed in the meantime the API answers 409 with the current version, and the UI shows the comparison. Bulk actions (D8) run in one transaction." Each object has its own version since #219 (ADR-0026), and the grid's `ProjectStore` already sends the version it read (ADR-0021).

## Decision

- **Every update and delete needs `If-Match`**, and so do the settings (`PATCH /projects/{p}`). Without it the API can't tell a lost update, so it answers **428** (`precondition-required`).
  - The header carries the object's version: `"3"`, or the weak `W/"3"` or plain `3`.
  - `*` isn't accepted: it would skip the check.
  - A creation needs none: there is nothing it could overwrite.
- **Reads give the version as an `ETag`** (`"3"`) on single objects and the settings, and as `version` in every body.
- **A stale version is 409** (`conflict`), as the specification says, rather than HTTP's 412, because the answer carries what the UI needs to compare: each conflicting object's current `version` and `value`. An object deleted meanwhile has `version: null` and `value: null`.
- **The check runs inside the write's transaction**, after the project row is locked (ADR-0026). Two writers on the same version can't both pass: of ten simultaneous saves on version 1, exactly one is kept (a test).
- **Batches**: `POST /projects/{p}/entities:batch` takes up to 2000 changes (`create`, `update` or `delete`, each update and delete with its `readVersion`), applied in one transaction, all or nothing.
  - Any stale change makes the whole batch a 409 that names only the stale objects.
  - A result that isn't schema-valid is a 422.
  - Creations without an id get one from the server.
  - Changes to the settings need `manage`; the others need `edit`.
- **Strict request validation**: the API's validator no longer removes unknown properties or converts types (Fastify's defaults). An unknown field or a wrong type is a 400. Removing properties would also break the batch body's `oneOf`.

## Alternatives considered

- **412 Precondition Failed for a stale `If-Match`.** It's HTTP's own code, but the specification asks for 409 with the current version, and the grid's store already models the conflict that way (ADR-0021).
- **Last write wins without `If-Match`.** It's simpler for clients, but it silently loses one user's work, which is exactly what A3 exists to prevent.
- **Row-level locks.** These are the same as ADR-0026's alternative. The project lock already serializes writes, and keeping the version check inside it is what makes it race-free.

## Consequences

- Every client write sends a version. The grid's API store (#221) passes the `readVersion` it already keeps.
- The comparison dialog (#221) gets the current value straight from the 409, without another request.
