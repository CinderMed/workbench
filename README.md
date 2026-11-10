# CinderMed

**FHIR Mapping Workbench.** A multi-user web workbench to map tabular datasets to FHIR R4 and R5 and generate FHIR Mapping Language (FML).

[![CI](https://github.com/CinderMed/workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/CinderMed/workbench/actions/workflows/ci.yml)
[![Docs](https://github.com/CinderMed/workbench/actions/workflows/docs.yml/badge.svg)](https://cindermed.github.io/workbench/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

> **Status: early development.** The foundations are in place (`v0.0.1`). The domain core (project model, FML generator, FHIR validation) comes next, then the web app. See the [module plan](docs/specification.md#incremental-module-plan).

## What it does

1. **Import a source**: a data file or a data dictionary (CSV, TSV, Excel), then correct types, allowed values and descriptions.
2. **Map it**: in a spreadsheet-style grid, choose for each column the FHIR resource role, the element and the transform; value maps turn local codes into standard codes (LOINC, SNOMED CT).
3. **Collaborate**: mappers, reviewers and engineers work on the same project with row statuses, comments and safe concurrent saving.
4. **Export**: StructureMaps in FML checked against the official grammar, the logical model of the source, ConceptMaps, a CSV/Excel mapping table and the JSON project file.

## Quick start

Requirements: Docker with Compose v2.20 or later.

```bash
git clone https://github.com/CinderMed/workbench.git
cd workbench
docker compose up --build
```

Open `http://localhost:8080` and sign in with a test user (`owner`, `mapper`, `reviewer`, `engineer` or `viewer`; password `cindermed-dev`). These accounts are for local development only. Copy `.env.example` to `.env` to change ports and passwords.

## Development

Requirements: Node.js 22 (`nvm use`) and pnpm (`corepack enable`).

```bash
pnpm install
pnpm build && pnpm typecheck && pnpm lint && pnpm test
pnpm --filter docs dev     # documentation site
```

See [CONTRIBUTING](.github/CONTRIBUTING.md) for branches, commits, changesets and the definition of done.

## Repository

| Path         | Content                                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| `apps/web`   | React web app                                                                         |
| `apps/api`   | Fastify REST API                                                                      |
| `apps/cli`   | `cindermed` command-line tool                                                         |
| `apps/docs`  | [Documentation site](https://cindermed.github.io/workbench/) (Astro Starlight)        |
| `packages/*` | Domain core: `model`, `fhir-defs`, `fml`, `normalizer`, `export`; plus `terminology`  |
| `fixtures/`  | Verified FML examples (golden tests) and the MOTU and Metastra spreadsheets           |
| `docker/`    | Docker Compose services and the development Keycloak realm                            |
| `docs/`      | [Specification](docs/specification.md) and [architecture decision records](docs/adr/) |

## License

[Apache License 2.0](LICENSE).
