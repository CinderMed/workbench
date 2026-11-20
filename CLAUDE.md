# CinderMed (FHIR Mapping Workbench)

Multi-user web workbench to map tabular datasets to FHIR (R4/R5) and generate FML.
Full specification: docs/specification.md. Verified examples: fixtures/fml-examples.

## Scope
- Design for any tabular dataset that can be mapped to FHIR: check every new feature against a wide
  table, a long table and several related tables; Metastra, MOTU and MIMIC-IV are only examples.

## Workflow
- Work one module at a time, in the build order of the "Incremental module plan" table:
  0, 1, 2, 3, 7, 3b, 4, 5, 6, 8, 9. Releases are numbered in build order (module 7 is v0.4.0).
- Before the first code branch of a module, propose the plan (branches, issues, open decisions) and wait.
- One feature per branch: feature/<id>-<name> (fix/, chore/, docs/, refactor/, ci/, test/ for the rest).
- Commits and PR titles in Conventional Commits: <type>(<scope>): <description>.
  Scopes: model, fhir-defs, fml, normalizer, export, terminology, api, web, cli, docs, infra, deps.
- Every PR: tests, a changeset (pnpm changeset) if a package changes, description from the template,
  "Closes #n" or "Part of #n" for the issue. Open the PR with gh pr create. Merging follows the
  'Decisions and merging' section.
- Never push directly to main. Squash merge. Never use an admin bypass of branch protection.

## Decisions and merging

### Ask me first (stop and wait) only for
- Contract changes: project, normalization, manifest schemas; translation rules; result codes and their severity.
- A new third-party dependency (workspace packages are fine).
- An ADR that changes or contradicts the specification.
- Scope changes: moving work between modules, dropping a done-when item.
- Anything hard to undo: releases, tags, npm publishing, repository or org settings, deleting branches with unmerged work.
- Anything posted outside this repository (issues or PRs on other repositories, HL7 Zulip, forums):
  draft it in the repository or in your message; I post it myself.
- Installing tools on my machine outside the repository (JDKs, global packages): say what and where first.

### Decide yourself, and record it
Everything else: implementation choices inside an approved plan, refactors, tests, fixes, docs, CI.
Record non-obvious choices in the PR description or in an ADR (status `accepted` unless it is on the "ask me" list).
Put any assumption you made in a "Decisions taken" list in the PR description.

### Merge yourself
Merge a PR yourself (`gh pr merge --squash --auto`) when all of these hold:
- CI is fully green, the Golden job included;
- it changes no contract and adds no third-party dependency;
- it does not touch fixtures/ expected files, CLAUDE.md or the release workflow;
- it has no open question for me.
Otherwise, leave the PR open and tell me in one short message what I need to decide.
After merging, add the PR to a short daily log in your next message to me (number, title, one line).

### Default principles for recurring choices
- Strict by default: an invalid or unknown value is blocked or reported, never dropped or guessed.
- Canonical forms inside the platform; locale and formats are declared only at the borders (import, display).
- A new translation rule or type combination needs a golden case first, built by the generator and run by the HL7 engine.
- Expected files in fixtures/ change only in a dedicated PR.
- New third-party dependencies: released at least 14 days ago, pinned to an exact version, licence compatible.
- No data values in logs or messages (values only in a separate `value` field); no patient data anywhere.
- When two options are equally good, pick the simpler one that is easier to change later, and record it.
- When the specification is silent, follow the closest existing ADR; when it is ambiguous, ask.

## Language
- English everywhere: code, comments, messages, schemas, commits, PRs, issues, ADRs, docs.
- UI text only through i18n, with English as the source locale; Italian is added as a translation.
- Test data from Italian sources (values, date and number formats) stays as it is.

## Technical rules
- TypeScript strict everywhere, no `any`; model types are generated from the JSON Schemas in packages/model.
- Domain packages (model, fhir-defs, fml, normalizer, export) do no I/O and do not import apps/* (ADR-0001).
  dependency-cruiser enforces the boundaries; apps/web never imports @cindermed/export or the FML grammar
  (ADR-0008, ADR-0012).
- The project, normalization and manifest schemas (packages/model/src/schemas; current version in each `$id`)
  are contracts: any change needs my approval; an incompatible change needs a new major version and a migration.
  A version not yet in a release may be extended branch by branch; once released, changes go in the next version.
  Every version change has a migration test from the previous version.
- FML translation follows the "Translation rules" and "Generator contract" sections.
  The generator builds only FML tree nodes and never concatenates FML strings.
  Add a golden case that covers a rule before changing it.
- Type compatibility follows the table in the Architecture section (ADR-0015); every new combination needs a golden case.
- FHIR checks (paths, types, bindings, references, cardinality) live in `validateFhir` in fhir-defs and read the
  compact definition index (ADR-0013, ADR-0014); the CLI and, from module 7, the browser load the index.
  Core FHIR packages are pinned by SHA-256; only apps download them.
- Golden tests (fixtures/fml-examples) must stay green on every commit. The HL7 engine is validator_cli 7.0.5
  on Java 21, pinned by SHA-256 in .github/workflows/ci.yml, kept in the git-ignored .fhir/validator/.
- Tests never write into fixtures/: outputs go to .tmp/ (git-ignored); expected files change only in a dedicated PR.
- Fixture maps (fixtures/fml-examples/*/*.map) are produced only by the generator, never edited by hand.
- Docs examples live in fixtures/ and run in CI; update the docs when user-visible behaviour changes.
- No patient data in the database or logs; no credentials in code, packages or logs; never commit .env files.
  HMAC keys for ids stay outside packages, reports and logs.
- The only real (non-synthetic) rows are the small MIMIC-IV demo slice in fixtures/fml-examples/mimic-iv-demo,
  under ODbL with its LICENSE and NOTICE.md; keep it small and keep those files. All other test rows are synthetic.
- The grid's local mode (module 7) has no login: it runs only on the developer's machine, bound to localhost.
  Never deploy it or expose it on a reachable address; the API storage (module 4) replaces it for shared use.
- Every technical decision not covered by the specification goes in docs/adr/NNNN-title.md.

## Commands
- pnpm install / pnpm -r build / pnpm test / pnpm lint / pnpm typecheck / pnpm format:check / pnpm changeset
- FHIR_CORE_PACKAGES=1 pnpm test (also the tests that need the R4 and R5 core packages)
- pnpm codegen (regenerate the packages/model types after a schema change, ADR-0004,
  and the FML grammar parser in packages/fml, ADR-0008)
- pnpm boundaries (dependency rules) / pnpm check:fixtures (fixture checksums)
- VALIDATOR=/abs/path/validator_cli.jar pnpm golden (golden suite; build packages and CLI first)
- docker compose up (full development stack)
- pnpm cindermed validate <project.json> / pnpm cindermed export <project.json> /
  pnpm cindermed mapping-table <project.json>
  (FHIR options: --offline, --fhir-cache <folder>, --no-fhir)
- pnpm --filter docs dev (documentation site)

## Done
A module is finished only when its "done when" criterion is proven by tests and the release PR is merged.
