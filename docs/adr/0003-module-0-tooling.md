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

## Addendum: versions and releases (module 0, `chore/changesets-release`)

**Changesets.** Changesets CLI v3 with `changesets/action` v2: the action's v2 line supports only CLI v3, and CLI v2 is in maintenance. `.changeset/config.json` puts `@cindermed/api` and `@cindermed/web` in one `fixed` group, written as the glob `@cindermed/{api,web}` so the configuration is valid before `apps/web` exists: their shared version is the workbench version. Every other package versions independently. Private packages are versioned but not tagged one by one (`privatePackages.tag: false`); per-package tags arrive with npm publishing at `v0.3.0`. `pnpm version-packages` runs `changeset version` and formats the generated changelogs and manifests with Prettier, so the "Version Packages" PR passes `format:check`.

**Changeset check.** `changeset-check.yml` (job `Changeset`) runs `tooling/release/changeset-check-cli.ts` on every PR and re-runs when labels change. A changeset is required when a file under `packages/*` or `apps/*` changes, except tests, `CHANGELOG.md`, `README.md` and the documentation site (`apps/docs`). It passes with the `no-changeset` label and on the "Version Packages" PR (`changeset-release/*`). The rules are pure functions with unit tests.

**Release workflow.** `release.yml` runs on every push to `main`:

1. With pending changesets, `changesets/action` opens or updates the "Version Packages" PR, titled `chore(infra): version packages`.
2. Without pending changesets, `tooling/release/product-release-cli.ts` reads the workbench version from `apps/api/package.json`. If its `vX.Y.Z` tag does not exist yet, it creates the tag and a GitHub Release, with notes taken from the changelog sections of every package bumped in that commit. Version `0.0.0` (nothing released) and existing tags are skipped, so the step is idempotent. Versions with a pre-release suffix become pre-releases.

The job exposes `released`, `version` and `tag` as outputs. Tags created with `GITHUB_TOKEN` do not trigger other workflows, so the jobs that run on a release (Docker images in `chore/docker-compose`, docs deploy in `docs/site-skeleton`) are added to `release.yml` and depend on these outputs.

**Tokens.** `changesets/action` needs the repository setting "Allow GitHub Actions to create and approve pull requests". A pull request opened with `GITHUB_TOKEN` does not trigger the CI workflows, so its required checks never report. The workflow uses an optional `RELEASE_TOKEN` secret (a fine-grained token or GitHub App token with contents and pull-requests write) when present. Without it, the "Version Packages" PR only changes versions and changelogs already checked on `main`, and an admin merges it.

## Addendum: Docker Compose development stack (module 0, `chore/docker-compose`)

**Layout.** The services are defined in `docker/compose.yaml`, as the repository layout says. A two-line `compose.yaml` at the root includes it, so `docker compose up` works from the repository root with no `-f`. Every variable has a development default, so no `.env` file is needed; `.env.example` lists the eight variables from the specification plus the passwords and ports of the stack.

**Images.** Exact tags: `node:22.23.4-alpine3.24` to build, `nginxinc/nginx-unprivileged:1.31.7-alpine` to serve the web app (non-root, port 8080, `/api/` proxied to the `api` service), `postgres:17.11-alpine` and `quay.io/keycloak/keycloak:26.8.2`. Renovate updates them with the same 7-day release age. The API image is made with `pnpm deploy --prod` and runs as the `node` user. The images install dependencies with `--ignore-scripts`: the only allowed install script (lefthook) is for git hooks.

**Keycloak.** `start-dev --import-realm` with `docker/keycloak/cindermed-realm.json`:

- the realm `cindermed`;
- the public client `cindermed-web`: authorization code flow with PKCE (S256), redirects to the web app and to the Vite dev server;
- one test user per project role (`owner`, `mapper`, `reviewer`, `engineer`, `viewer`) with `@cindermed.test` emails. Roles are per project and live in the database (specification, "Permissions"); these users only make the roles easy to try once module 4 assigns them.

The realm file contains no password: the users' password comes from the `CINDERMED_DEV_PASSWORD` placeholder, which Keycloak resolves from the environment at import. `KC_HOSTNAME` is the published address (`http://localhost:8081`), so tokens have the same issuer for the browser and for the API. The bootstrap admin, the test users and PostgreSQL have development-only default passwords set in `docker/compose.yaml`. They are not production credentials and must be changed on any shared server. Keycloak keeps its own data in the container (dev-file); the realm is imported again on every start.

**Web shell.** Module 0 has no features, so the web app only proves the stack: it signs the user in with `oidc-client-ts` and shows the user's name and a sign-out button. Its text goes through i18next (English source locale). The OIDC authority and client are fixed at build time (Vite variables, Docker build arguments). The API only answers `GET /api/health`; JWT verification arrives with A2 in module 4.

**Verification.** The CI job `Docker Compose` builds and starts the stack, then runs `tooling/compose/smoke.sh`. The script checks that the web app is served, that the API answers through the web proxy, that Keycloak shows the login form for `cindermed-web`, and that a test user signs in and is redirected back to the web app with an authorization code. Image publishing is a job of `release.yml` that runs after a product release: `ghcr.io/cindermed/workbench-api` and `workbench-web`, tagged `X.Y.Z` and `sha-<commit>`, plus `latest` for stable versions, with build provenance.

## Addendum: documentation site (module 0, `docs/site-skeleton`)

**Site.** `apps/docs` (`@cindermed/docs`) uses Astro Starlight. English is the root locale, configured so that an Italian locale can be added later as a translation (ADR-0002). It is published on GitHub Pages at `https://cindermed.github.io/workbench/` until a domain is chosen. The sidebar has "Start here" (getting started with `docker compose up`), "Guides" (the Metastra and MOTU walkthroughs, module 9) and "Reference" (schemas and REST API, generated later). `starlight-links-validator` fails the build on a broken internal link, and `astro check` type-checks the site.

**Workflow.** `docs.yml` (job `Docs build`) builds the site and validates its links on every PR and every push to `main`. Deploying uses the same workflow:

- called by `release.yml` after a product release, for the release tag (tags created with `GITHUB_TOKEN` trigger no workflow, see above);
- by hand (`workflow_dispatch`) for a given tag, for releases made before the workflow existed (`v0.0.1`).

Versioned docs per minor release come with the first walkthroughs; until then the site shows the latest release. GitHub Pages must be enabled with "GitHub Actions" as the source.

**Boundaries and lint.** `apps/docs` is outside the ADR-0001 package boundaries: dependency-cruiser skips it, because Astro's virtual `astro:*` modules cannot be resolved. It needs no changeset (see the changeset check). ESLint ignores the generated `.astro/` folder.
