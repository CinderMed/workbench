# ADR-0003: Module 0 tooling

- Status: accepted
- Date: 2026-11-10
- Module: 0 (Foundations)

## Context

The specification fixes the stack (TypeScript strict, pnpm workspaces, Vitest, dependency-cruiser, lefthook with commitlint) and the quality rules (no `any`, package boundaries from ADR-0001, coverage of 90% in the domain packages and 70% in the apps, test outputs only in `.tmp/`). It does not fix the linter, the formatter, the TypeScript version, how coverage is enforced per package or how the npm supply chain is guarded. This ADR records those choices.

## Decision

**Runtime and package manager.** Node.js 22 (`.nvmrc`, `engines >=22.12.0`, required by Vitest 5). pnpm 12, pinned in `packageManager`. pnpm's default minimum release age is kept: new dependency versions are installed only after the waiting period, and no exclusions are added. Dependency build scripts are denied unless listed in `allowBuilds` in `pnpm-workspace.yaml`; only `lefthook` (installs the git hooks) is allowed.

**TypeScript 6.0.** TypeScript 7 (the native compiler) is the current release, but typescript-eslint supports only `<6.1.0`. We pin `~6.0.3` and move to 7 when typescript-eslint supports it. `tsconfig.base.json` enables `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` and `verbatimModuleSyntax`.

**Packages.** Each package and app has `tsconfig.json` (type checking, tests included) and `tsconfig.build.json` (emits `dist/`, tests excluded). All packages are private with version `0.0.0` until the release setup (module 0) and npm publishing (`v0.3.0`). The CLI is `@cindermed/cli` with the `cindermed` command; its published npm name is decided with `ci/npm-publish` in module 3.

**Linting and formatting.** ESLint with typescript-eslint `strictTypeChecked` and `stylisticTypeChecked` (type-aware, `no-explicit-any` as an error), and Prettier for formatting (`printWidth` 100), with `eslint-config-prettier` so the two do not overlap. `CLAUDE.md`, `docs/specification.md` and `fixtures/` are not reformatted.

**Package boundaries (ADR-0001), checked three ways.**

1. dependency-cruiser (`.dependency-cruiser.cjs`, `pnpm boundaries`): packages do not import `apps/*`; the domain packages (`model`, `fhir-defs`, `fml`, `normalizer`, `export`) do not import Node I/O modules (`fs`, `net`, `http`, `child_process`, …) or database and HTTP libraries; `web` does not import `api`; no cycles; no unresolvable imports. The rules have their own tests in `tooling/boundaries.test.ts`.
2. ESLint `no-restricted-globals` in the domain packages: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `process`, `Buffer`.
3. The domain packages compile with `"types": []`, so Node globals are not even declared there.

`terminology` is not a domain package: it calls terminology servers and may do network I/O.

**Tests and coverage.** One root Vitest configuration with three projects (`packages`, `apps`, `tooling`); `pnpm test` runs them all with V8 coverage, and each package can still run `vitest run` on its own (`pnpm -r test`). Thresholds use globs: 90% of lines in the five domain packages and in `terminology`, 70% in the apps. Coverage reports and every other test output go to `.tmp/` (git-ignored); tests never write into `fixtures/`.

**Fixtures integrity.** `pnpm check:fixtures` runs `sha256sum --check --strict` on `fixtures/fml-examples.sha256`. lefthook runs it when a commit touches `fixtures/`, and CI runs it as a required step (module 0, `ci/github-actions`). Expected files change only in a dedicated PR that also updates the checksum file.

**Commits.** lefthook runs commitlint (`@commitlint/config-conventional`, scopes restricted to the list in `CLAUDE.md`) on `commit-msg`, and Prettier, ESLint and the fixtures check on `pre-commit`, on the staged files only.

## Consequences

- One command per check (`pnpm build`, `typecheck`, `lint`, `format:check`, `boundaries`, `check:fixtures`, `test`), reused as-is by CI.
- A domain package that tries to do I/O fails type checking, lint and the boundary check.
- Adding a dependency with an install script needs an explicit `allowBuilds` entry, reviewed in the PR.
- The TypeScript 7 upgrade is blocked on typescript-eslint and needs a follow-up when support lands.
- Coverage thresholds on empty packages are trivially met; they start to matter from module 1.

## Addendum: community files (module 0, `chore/org-community-files`)

The specification puts the community files (CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue and pull request templates, `FUNDING.yml`) in the organization's `CinderMed/.github` repository, which GitHub applies to every repository. While `workbench` is the only repository, they live in `workbench/.github/`. They move to `CinderMed/.github` when a second repository exists (the `website`, or the extracted core from ADR-0001); `workbench` then keeps only what is specific to it.

`tooling/community-files.test.ts` checks that the issue forms are valid YAML, that the pull request template keeps the sections required by the specification, and that the commit scopes listed in CONTRIBUTING match `commitlint.config.js`.

## Addendum: GitHub Actions (module 0, `ci/github-actions`)

**Jobs.** `ci.yml` has one job per required check, so each one shows up and can be required on its own: `Fixtures checksum`, `Lint` (Prettier, ESLint, dependency-cruiser), `Types`, `Unit tests` (coverage thresholds; report uploaded as an artifact), `Build` and `Golden`. A shared composite action (`.github/actions/setup`) installs Node from `.nvmrc` and pnpm from `packageManager`, with the pnpm store cached and `--frozen-lockfile`.

**Golden job.** `fixtures/fml-examples/tests/run-all.sh` writes its outputs next to its inputs and always exits 0. `tooling/golden/run-examples.sh` (`pnpm golden`) therefore runs it on a copy in `.tmp/golden`, requires `Total: 7 passed, 0 failed`, and requires every file it regenerates (normalized rows, Bundles) to be identical to the committed one. The job uses Temurin Java 21 and the HL7 validator `7.0.5`, the version the examples were verified with; the jar is checked against the SHA-256 digest GitHub publishes for the release asset, and it is cached together with `~/.fhir/packages`. From module 2 the job also runs the generator's golden cases.

**Supply chain.** Every external action is pinned to a full commit SHA, with the version in a comment, and only releases at least 7 days old are used; `tooling/workflows.test.ts` fails on any action referenced by tag. Workflows get read-only `contents` permission by default.

**Dependency updates.** Renovate (`renovate.json`) rather than Dependabot, because it handles pnpm workspaces and lockfile maintenance well: one weekly grouped PR for non-major updates, one for GitHub Actions (kept pinned by digest), `minimumReleaseAge` of 7 days, `chore(deps)` titles and the `no-changeset` label. TypeScript is held below 6.1 (see above). Renovate needs its GitHub App installed on the organization.

**Code scanning and branch protection.** `codeql.yml` runs on every PR, every push to `main` and weekly. On the Free plan, code scanning and branch protection are available only for public repositories; the repository is public, so both apply. The CodeQL job still has a guard that skips it if the repository is ever made private again, instead of failing on the upload.
