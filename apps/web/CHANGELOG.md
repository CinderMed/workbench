# @cindermed/web

## 0.2.0

### Minor Changes

- bcface3: Module 2 (Generator and package): the FML generator (G2) with the logical models and normalization specs (G1), ConceptMaps from value maps (G3), the grammar check against `mapping.g4` (G10), the export package with its manifest (G7, `cindermed export`), the reference normalizer, and the mapping table as CSV and XLSX (H1, `cindermed mapping-table`). The API and web app do not use them yet.

  Known limitation (#134): some column names produce a map that passes `mapping.g4` but that the HL7 engine rejects when it parses the FHIRPath conditions. So far this has been seen with names whose second character is `_` (for example `a_b` or `c__mood`); the exact rule and the fix are planned for the start of module 3. Until then, rename such columns.

## 0.1.0

### Minor Changes

- 48047b9: Module 1 (Domain core): the project model with its JSON Schemas and generated types, the eight integrity rules (structural parts), the JSON project file (H3), and the `cindermed validate` command. The API and web app do not use them yet.

## 0.0.1

### Patch Changes

- 4735681: First development stack: the API answers `GET /api/health`, and the web app signs users in through Keycloak (authorization code flow with PKCE) and shows who is signed in. `docker compose up` starts the web app, the API, PostgreSQL and Keycloak with a development realm.
