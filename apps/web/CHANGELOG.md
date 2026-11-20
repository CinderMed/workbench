# @cindermed/web

## 0.4.0

### Minor Changes

- 3801a69: `cindermed fhir-index <project.json> --out <folder>` writes the compact FHIR definition index of a project's FHIR version and packages (#173, ADR-0021); the web app's dev server serves `apps/web/.fhir-index` under `/fhir-index/` to the local mode, on localhost only and never in the production build.
- 0042c61: Mapping grid (D1, #36) in the local mode: one table at a time, with a switcher for projects with several tables; one line per mapping row and one per column without rows; virtualized rows (TanStack Table and TanStack Virtual); keyboard navigation and editing of Role and Element, saved object by object through the storage interface, with refused values kept in their cell with the reason.
- 1aa9dcb: Two groupings in the mapping grid (D2, #37): rows grouped by source section or by target role, with a toggle; each group has a header with its row count that closes and opens with Enter or a click; rows without a section or a role come last.
- f494531: Path picker (D3, #38): Enter or a double-click on an Element cell opens the element tree of the row's role, from the FHIR definitions of the local mode, with cardinality, types and choice elements under their concrete names; it is searched by name, opened from the keyboard, and the chosen path is saved to the row. F2 still types the path by hand.
- 7d6d47b: Named slices (D4, #39) in the local mode: on a repeating element such as `component`, the path picker names a repetition (`component[nrs]`) with a fixed value that tells it apart (a code, entered as `manual`, or a simple value), saves it in the role and shows it under its element for the rows to write to; the role editor lists each role's slices and deletes one after saying how many rows write to it.
- 651e7a9: The path picker checks each element against the row's column and transform (D5, #40; type compatibility in the grid, point 1): an element the row can never be written to is greyed, cannot be chosen and shows why; one that needs another transform can be chosen, and the picker names the transforms.
- b51be33: Guided transforms (D5, #40) in the local mode: Enter, F2 or a double-click on a Transform or Values cell opens the row's transform editor (copy, conversion with the input format, value map, quantity with a fixed UCUM unit or a unit column and its value map, coding with a display column; concatenation is not offered until the FML export can write it, #98) and the `repeat` of a multiple-choice row; "Add constant row" adds a row with a typed value and no column.
- 722b414: Findings in the local mode (D7, #16): a details bar under the grid shows the severity, code and message of every finding on the selected cell, from the mouse or the keyboard (aria-describedby); a tooltip shows them on hover; "Show all findings" lists every finding with its row and column, and choosing one selects its cell, switching table or opening its group.
- c02ad7d: Inline validation in the local mode (D7, #16): after every change the project is checked in a Web Worker with the same rules as `cindermed validate` (schema, integrity, quality, and the FHIR checks with the definitions from `cindermed fhir-index`); the grid colours error cells red and warning cells yellow with the reasons, a summary shows the counts and whether the FHIR checks ran, and results of an older run are dropped.
- c080852: Filters and bulk actions (D8, #41) in the local mode: filters by review status, role and section; rows selected with Space, Ctrl or Cmd-click, Shift-click or "Select all shown"; a role or a review status set on all selected rows in one change. The role editor keeps the Index field empty while it is cleared, so a typed index replaces the proposed one, and refuses an empty index.
- bcdac1f: Module 7 (the mapping grid, in the local mode): the spreadsheet-style grid with groups by section or role, the path picker with named slices, guided transforms, filters and bulk actions (D1–D5, D8), a minimal role editor, inline validation with the same checks as `cindermed validate` (D7), and two CLI commands: `cindermed init` (an empty project from a data file's header) and `cindermed fhir-index` (the FHIR definitions for the browser).

  **The grid runs only in the local mode**: the Vite development server on your own computer, bound to `127.0.0.1`, editing one project file. Start it from the repository root with `pnpm -r build`, then `pnpm --filter @cindermed/web dev`, and open `http://127.0.0.1:5173`; write the FHIR definitions once with `pnpm cindermed fhir-index <project.json> --out apps/web/.fhir-index`. The production build and the Docker images, `workbench-web:0.4.0` and `latest` included, **do not contain the grid**.

  No login, no shared projects and no API storage until module 4: the local mode has no login and must never be exposed on an address other people can reach.

  Known limitations:

  - #156: on a choice element (`value[x]`), a value whose type is not the chosen one is reported as `TYPE_MISMATCH` and greyed in the path picker, until the generator writes choice elements with an explicit type.
  - #194: a cell with `TYPE_NEEDS_TRANSFORM` names the transform to use, but it is set by hand in the transform editor; a one-click fix is planned.
  - #98: concatenation is not offered in the transform editor until the FML export can write it; a row that already has one (from a project file) shows a notice, and `cindermed export` refuses it (`TRANSFORM_UNSUPPORTED`).
  - Review statuses can be set in bulk, but statuses and comments as a workflow (A5, A6), with who may set them, come with module 4.

- e09995c: Minimal role editor in the local mode (#174): a Roles tab to create, edit and delete roles (resource type, index, label, table), with the next free index and a default id rule from the table's row key; deleting a role that rows use asks first and keeps the rows, which then show an error.
- 232b1ec: Local mode of the web app (#173, ADR-0021): in the Vite dev server only, bound to 127.0.0.1 (any other address stops the server), the app opens a project file from this computer, keeps it in memory and saves it back object by object through `LocalFileStore`; the production build does not contain it. `@cindermed/model` adds `applyChanges` (create, update and delete of project settings, tables, columns, relations, roles, rows and value maps, refused only when the result would not match the schema), `nextRowCode` and `objectKey`.

### Patch Changes

- 84850af: Third-party dependencies are pinned to the exact versions already in the lockfile (no version changes).
- d1857df: Inline validation: every run of the validation worker answers, with the error when a check fails (the summary says the check failed and why), a failed opening of the FHIR definitions is retried on the next run, and only the newest waiting request runs next, so fast edits never build a queue.
- Updated dependencies [84850af]
- Updated dependencies [232b1ec]
  - @cindermed/model@0.5.0
  - @cindermed/fhir-defs@0.1.1

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
