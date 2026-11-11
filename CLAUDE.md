# CinderMed (FHIR Mapping Workbench)

Multi-user web workbench to map tabular datasets to FHIR (R4/R5) and generate FML.
Full specification: docs/specification.md. Verified examples: fixtures/fml-examples.

## Workflow
- Work one module at a time, in the order of the "Incremental module plan".
- One feature per branch: feature/<id>-<name> (fix/, chore/, docs/, refactor/, ci/ for the rest).
- Commits and PR titles in Conventional Commits: <type>(<scope>): <description>.
  Scopes: model, fhir-defs, fml, normalizer, export, terminology, api, web, cli, docs, infra, deps.
- Every PR: tests, a changeset (pnpm changeset) if a package changes, description from the template,
  "Closes #n" for the issue. Open the PR with gh pr create; do not merge it: I review it.
- Never push directly to main. Squash merge.

## Language
- English everywhere: code, comments, messages, schemas, commits, PRs, issues, ADRs, docs.
- UI text only through i18n, with English as the source locale; Italian is added as a translation.
- Test data from Italian sources (values, date and number formats) stays as it is.

## Technical rules
- TypeScript strict everywhere, no `any`; model types are generated from the JSON Schemas in packages/model.
- Domain packages (model, fhir-defs, fml, normalizer, export) do no I/O and do not import apps/* (ADR-0001).
- The project (1.2.0), normalization (1.0.0) and manifest (1.0.0) schemas are contracts:
  an incompatible change needs a new major version, a migration and my approval.
- FML translation follows the "Translation rules" and "Generator contract" sections.
  The generator builds only FML tree nodes and never concatenates FML strings.
  Add a golden case that covers a rule before changing it.
- Type compatibility follows the table in the Architecture section; every new combination needs a golden case.
- Golden tests (fixtures/fml-examples) must stay green on every commit.
- Tests never write into fixtures/: outputs go to .tmp/ (git-ignored); expected files change only in a dedicated PR.
- Docs examples live in fixtures/ and run in CI; update the docs when user-visible behaviour changes.
- No patient data in the database or logs; no credentials in code, packages or logs.
- Every technical decision not covered by the specification goes in docs/adr/NNNN-title.md.

## Commands
- pnpm install / pnpm -r build / pnpm -r test / pnpm lint / pnpm typecheck / pnpm changeset
- pnpm codegen (regenerate the packages/model types after a schema change, ADR-0004,
  and the FML grammar parser in packages/fml, ADR-0008)
- docker compose up (full development stack)
- pnpm cindermed validate <project.json> / pnpm cindermed export <project.json>
- pnpm --filter docs dev (documentation site)

## Done
A module is finished only when its "done when" criterion is proven by tests and the release PR is merged.