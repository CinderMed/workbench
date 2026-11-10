# Contributing to CinderMed

Thank you for helping. CinderMed (FHIR Mapping Workbench) maps tabular datasets to FHIR R4/R5 and generates FML. The full specification is in [`docs/specification.md`](../docs/specification.md); decisions not covered there are in [`docs/adr/`](../docs/adr/).

## Before you start

- Every change starts from a GitHub issue. Features use the ID from the specification (e.g. "D3 – Path picker") and carry a `module-N` label.
- Work follows the "Incremental module plan": one module at a time.
- English everywhere: code, comments, messages, schemas, commits, pull requests, issues, ADRs and docs. UI text goes only through i18n, with English as the source locale.
- Never commit patient data, credentials or API keys. Test data comes from `fixtures/`.

## Set up

```bash
nvm use            # Node 22, from .nvmrc
corepack enable    # pnpm, pinned in package.json
pnpm install       # also installs the git hooks (lefthook)
```

## Development stack

```bash
docker compose up --build   # web http://localhost:8080, API :3000, Keycloak :8081
```

Sign in with a test user (`owner`, `mapper`, `reviewer`, `engineer` or `viewer`; password `cindermed-dev` unless `CINDERMED_DEV_PASSWORD` is set). Copy `.env.example` to `.env` to change ports and passwords. `pnpm --filter @cindermed/web dev` starts the web app with Vite on port 5173, using the same Keycloak.

## Checks

Run them before opening a pull request; CI runs the same commands.

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm boundaries       # package boundaries (ADR-0001)
pnpm check:fixtures   # fixtures/ must match fixtures/fml-examples.sha256
pnpm test             # unit tests with coverage
```

Tests never write into `fixtures/`: outputs go to `.tmp/`. Expected files in `fixtures/` change only in a dedicated pull request that also updates the checksum file.

## Branches

One feature (or one coherent piece of a module) per branch, created from an up-to-date `main`:

- `feature/<id>-<name>` for features, e.g. `feature/d3-path-picker`
- `fix/`, `chore/`, `docs/`, `refactor/`, `ci/` followed by a kebab-case name for the rest

Never push to `main` directly.

## Commits and pull request titles

[Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <description>`, in English, in the imperative.

- Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`; `!` or `BREAKING CHANGE:` for incompatible changes.
- Scopes: `model`, `fhir-defs`, `fml`, `normalizer`, `export`, `terminology`, `api`, `web`, `cli`, `docs`, `infra`, `deps`.

commitlint checks commit messages locally (lefthook); CI checks pull request titles. Pull requests are squash-merged, so the title becomes the commit on `main`.

## Pull requests

- Fill in the template, including `Closes #n` for the issue.
- Keep it under roughly 600 changed lines excluding tests.
- Add a changeset (`pnpm changeset`) when a package's behaviour changes, or use the `no-changeset` label with a reason.
- Add an ADR (`docs/adr/NNNN-title.md`: context, decision, consequences) for every technical decision not covered by the specification.
- FML translation changes need a new golden case first. The project (1.2.0), normalization (1.0.0) and manifest (1.0.0) schemas are contracts: an incompatible change needs a new major version, a migration and the maintainers' approval.
- At least one maintainer approval and green checks are required before merging.

## Definition of done

- [ ] Behaviour covered by tests (unit; golden if it touches the FML translation; end-to-end if it touches a UI flow)
- [ ] Lint, types and coverage green
- [ ] Changeset added, or a justified `no-changeset` label
- [ ] UI text through i18n, in English
- [ ] Documentation page updated if user-visible behaviour changes
- [ ] ADR for every new decision; specification updated if a contract changes
- [ ] Issue linked and feature checked by the reviewer

## Code of conduct

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
