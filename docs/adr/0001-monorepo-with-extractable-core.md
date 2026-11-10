# ADR-0001: One monorepo, with an extractable domain core

- Status: accepted
- Date: 2026-11-09
- Module: 0 (Foundations)
- Source: docs/specification.md, "Architecture decision records"

## Context

The FML translator is not only the `fml` package: it needs the project schema (`model`), the FHIR definitions for type checks (`fhir-defs`), the normalization (`normalizer`) and the export (`export`). The separable unit is therefore the whole domain core, built in modules 1–3, and the web app is one of its clients.

During the MVP almost every feature changes schema, generator and UI together. With two repositories, each change would become two pull requests, a core release and a dependency bump, and the golden tests would be split across two CIs.

## Decision

Keep the core in the `workbench` monorepo, isolated as if it were separate:

- the domain packages (`model`, `fhir-defs`, `fml`, `normalizer`, `export`) do no network or database I/O and do not import `apps/*`. CI fails if they do: dependency-cruiser checks imports, ESLint bans I/O globals, and the packages compile without Node types (ADR-0003);
- the core packages have their own versions and are published to npm, together with the `cindermed` CLI (from `v0.3.0`);
- the project file format has its own version (`formatVersion`), independent of the app's.

**Extraction criteria.** Move the core to its own repository (for example `core`) when one of these happens:

- the project format is stable (after `v1.0.0`);
- a second consumer appears (the conversion module, the AI assistant or another project);
- outside contributors want to work only on the translator.

`git filter-repo` keeps the commit history, so waiting costs nothing.

## Consequences

- One pull request per feature, even when it touches schema, generator and UI; golden tests run in one CI.
- The boundaries are enforced by tooling, not only by convention, so extraction stays a mechanical move.
- Community files live in `workbench/.github/` until a second repository exists (ADR-0003).
