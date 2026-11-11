# ADR-0004: Model types generated from the JSON Schemas

- Status: accepted
- Date: 2026-11-11
- Module: 1 (Domain core)

## Context

CLAUDE.md requires the model types to be generated from the JSON Schemas in `packages/model`, so that the schemas stay the only source of truth. The specification does not say which generator to use, when it runs, or how the output reaches the other packages. The schemas are contracts: they are verbatim copies of `fixtures/fml-examples` and are never edited to suit a tool.

## Decision

- **Generator.** `json-schema-to-typescript`, a root dev dependency, driven by `tooling/codegen/model-types.ts`. `pnpm codegen` (also `pnpm --filter @cindermed/model codegen`) writes `packages/model/src/generated/{project,normalization,manifest}.ts`, formatted with the repository's Prettier configuration.
- **Committed output.** The generated files are committed. The build stays a plain `tsc`, reviewers see type changes in the diff of the PR that changes a schema, and editors work without a generation step.
- **Drift check.** `tooling/codegen/model-types.test.ts` regenerates the types in memory and compares them with the committed files. It runs in the unit tests on every commit, so a schema changed without `pnpm codegen` fails CI.
- **In-memory adjustments, never in the schema files.** Before generation the tool works on a copy where:
  - `title` and `$id` are removed, so the root types get code names (`ProjectFile`, `NormalizationSpec`, `ExportManifest`) instead of prose or URL-derived names. Every `$ref` is local, so `$id` is not needed.
  - The siblings of a `$ref` (e.g. the `description` of `Column.unit`) are moved next to `allOf: [{ $ref }]`. Otherwise the ref parser merges them into a new object and the generator emits duplicates such as `Coding1`. A test checks that no numbered duplicates appear.
- **Exports.** The project types are exported by name. The normalization and manifest definitions share names with the project ones (e.g. `Column`), so they are exported under the `Normalization` and `Manifest` namespaces, with only their root types exported by name.
- **Type guards.** `isProjectFile`, `isNormalizationSpec` and `isExportManifest` narrow `unknown` through the Ajv validators.
- **Lint.** ESLint checks the generated files with one rule off (`consistent-indexed-object-style`, the generator's style).

## Consequences

- Types only describe the shape. Patterns (ids of 6–64 characters, names without surrounding spaces), formats and `if`/`then` rules are checked at run time by the validators, so a value can typecheck and still fail validation.
- Changing a schema is a two-step PR: edit the schema (contract rules apply), run `pnpm codegen`, commit both.
- Upgrading `json-schema-to-typescript` may change the output. The drift test catches it, and the upgrade PR regenerates the files.
- Revisit if the generator cannot express a future schema construct well enough. A hand-written type for one definition would then need its own ADR addendum.
