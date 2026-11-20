# @cindermed/api

## 0.4.0

### Minor Changes

- bcdac1f: Module 7 (the mapping grid, in the local mode): the spreadsheet-style grid with groups by section or role, the path picker with named slices, guided transforms, filters and bulk actions (D1–D5, D8), a minimal role editor, inline validation with the same checks as `cindermed validate` (D7), and two CLI commands: `cindermed init` (an empty project from a data file's header) and `cindermed fhir-index` (the FHIR definitions for the browser).

  **The grid runs only in the local mode**: the Vite development server on your own computer, bound to `127.0.0.1`, editing one project file. Start it from the repository root with `pnpm -r build`, then `pnpm --filter @cindermed/web dev`, and open `http://127.0.0.1:5173`; write the FHIR definitions once with `pnpm cindermed fhir-index <project.json> --out apps/web/.fhir-index`. The production build and the Docker images, `workbench-web:0.4.0` and `latest` included, **do not contain the grid**.

  No login, no shared projects and no API storage until module 4: the local mode has no login and must never be exposed on an address other people can reach.

  Known limitations:

  - #156: on a choice element (`value[x]`), a value whose type is not the chosen one is reported as `TYPE_MISMATCH` and greyed in the path picker, until the generator writes choice elements with an explicit type.
  - #194: a cell with `TYPE_NEEDS_TRANSFORM` names the transform to use, but it is set by hand in the transform editor; a one-click fix is planned.
  - #98: concatenation is not offered in the transform editor until the FML export can write it; a row that already has one (from a project file) shows a notice, and `cindermed export` refuses it (`TRANSFORM_UNSUPPORTED`).
  - Review statuses can be set in bulk, but statuses and comments as a workflow (A5, A6), with who may set them, come with module 4.

### Patch Changes

- 84850af: Third-party dependencies are pinned to the exact versions already in the lockfile (no version changes).

## 0.3.0

### Minor Changes

- 3161ab2: Module 3 (FHIR definitions and validation): the compact FHIR definition index and package loader (`@cindermed/fhir-defs`), and `cindermed validate` and `cindermed export` checking a project against the FHIR definitions of its version, R4 or R5 (D7: paths, type compatibility, bindings, cardinality in a first version; F4: references). FHIR errors block the export. Project format 1.4.0 adds a Coding or CodeableConcept from a code column (`coding` transform) and profile slice names that start with an upper-case letter (`category[VSCat]`). The API and web app do not use them yet.

  Known limitations:

  - #156: the generator writes choice elements by their base name, so the HL7 engine takes the type of the value. Until this is fixed, the combinations it cannot run are reported as `TYPE_MISMATCH`: on a choice element, a value whose type is not the chosen one; a quantity into Age, Duration, Distance or Count.
  - Cardinality, first version: `DUPLICATE_TARGET` is a warning, and only conditions on the same column (different values, or a value against none) are recognised as exclusive.
  - #146: the export manifest does not yet record the SHA-256 of each FHIR package a project uses (planned before npm publishing, module 3b).

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
