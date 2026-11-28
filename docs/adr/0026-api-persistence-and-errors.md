# ADR-0026: API persistence of project objects, errors and OpenAPI

- Status: accepted
- Date: 2026-11-27
- Module: 4 (Platform)
- Issue: #219

## Context

Module 4 moves projects from files to the API, where several users edit the same project (specification, "Data and persistence"). The specification fixes the tables: every object of the project file is a database row, and the file is reassembled on export. It also fixes the stack (PostgreSQL 17, Kysely, SQL migrations, Fastify 5) and the error format (RFC 9457), with the OpenAPI document at `/api/docs`. The grid already writes through object-level changes, which `applyChanges` in `@cindermed/model` keeps only when the project stays schema-valid (ADR-0021).

The plan and its new dependencies (kysely, pg, @fastify/swagger) were approved on 2026-11-27.

## Decision

- **Tables.**
  - `projects` holds the `project` block of the file (`settings`), plus `meta`: `$schema`, `formatVersion`, `templates`, `extensions`, and whether the file had an empty `sourceRelations`. The file is written back byte for byte through `serializeProject`; a test checks this for every fixture project.
  - `entities` holds one row per source (without its columns), column (with its table as `parent_id`), source relation, role, row and value map. The data is JSONB, with a version and the last author and date.
  - `position` keeps each list's order. A new object goes last and a deletion leaves a gap, so a write touches only its own rows.
  - Templates stay in `meta` until an editor for them exists. Comments become rows of their own with A6 (module 4 plan).
- **Writes go through the model.** A write locks its project row (`SELECT … FOR UPDATE`), reassembles the file, applies the changes with `applyChanges`, and stores only the objects they touched, all in one transaction.
  - A change that would leave the project schema-invalid is refused (422, with the schema results). Integrity and FHIR findings never refuse a change (ADR-0021).
  - Locking the whole project serializes writes per project. That's simple and correct; one project's objects change at human speed.
- **Ids.**
  - The server gives a new object an id when its value has none: `<prefix>_<16 base-36 characters>`, with the prefixes of the local store (`map_`, `col_`, …).
  - An imported file keeps its project id when no project has it, and gets a new one otherwise.
- **Migrations** are SQL files in `apps/api/migrations`, applied in name order by a small runner. Each runs once, in its own transaction, recorded in `schema_migrations`, under an advisory lock. The API applies them at startup. Kysely's own migrator takes TypeScript migrations, and the specification asks for SQL.
- **Callers.**
  - Every route except `/api/health` and `/api/docs` needs an authenticated caller, who gets a `users` row on first sight.
  - The default authentication refuses everyone (401) until the JWT check (#19), so no project route can answer without a user.
  - Until #19 brings the role permissions, every project route needs a member of the project, and a non-member gets 404, as if the project didn't exist.
- **Rate limit**: `@fastify/rate-limit` (approved on 2026-11-27, after CodeQL's `js/missing-rate-limiting` alert) allows 600 requests per client address and minute on every route except the health check. It runs before the authentication hook, so it also limits guessing credentials. The count is kept in memory, enough for the MVP's single API instance; several instances would need a shared store or the reverse proxy's limit. Past the limit the answer is 429, as a problem.
- **Errors** are `application/problem+json`, with a stable `code` that is also the last segment of `type` (`https://cindermed.org/problems/<code>`).
  - Messages name objects and fields, never values.
  - A 500 logs only the error's name and code, because database messages can quote values.
- **OpenAPI**: `@fastify/swagger` builds the document from the route schemas and serves it as JSON at `/api/docs`. An interactive page would need another dependency (`@fastify/swagger-ui`). The documentation site can render the JSON later.
- **Tests** run on PostgreSQL 17: a service container in the CI Unit tests job, a local container otherwise (`TEST_DATABASE_URL`). Each test file uses a schema of its own, so files run in parallel. Without the variable the tests are skipped, except in CI, where they fail.

- **History** (#220, added 2026-11-28): `entity_revisions` keeps the state every write leaves an object in, settings included. Each revision has its version, its kind of change (`import`, `create`, `update`, `delete`), its author and its date, and is written in the same transaction as the write.
  - A deletion keeps the version it deleted, with no data. A table's columns get theirs when the table goes.
  - A refused write leaves nothing.
  - `GET /projects/{p}/entities/{kind}/{id}/history` and `GET /projects/{p}/history` (settings) list the revisions newest first, 100 by default and up to 9999.
  - The revisions are kept for the project's lifetime and deleted with it. Their UI and restore (A7) are V2, and a restore will be a new write with the old data.

## Alternatives considered

- **One JSONB document per project.** Simple, but every write would rewrite the whole project and conflict with every other write, which defeats per-object concurrency (A3) and per-object history.
- **Per-object row locks instead of a project lock.** More concurrency, but a change's validity depends on the whole project (a reference to a deleted object), so the check needs a consistent view of all of it.
- **Kysely's migrator.** It needs TypeScript migration modules; plain SQL files are easier to review and run by hand.

## Consequences

- Project routes answer only in tests until #19 lands.
- `entities.kind` doesn't yet include `template` and `comment`, which the specification lists. They arrive with the features that edit them.
