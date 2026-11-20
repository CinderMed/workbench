---
"@cindermed/api": minor
"@cindermed/web": minor
---

Module 7 (the mapping grid, in the local mode): the spreadsheet-style grid with groups by section or role, the path picker with named slices, guided transforms, filters and bulk actions (D1–D5, D8), a minimal role editor, inline validation with the same checks as `cindermed validate` (D7), and two CLI commands: `cindermed init` (an empty project from a data file's header) and `cindermed fhir-index` (the FHIR definitions for the browser).

**The grid runs only in the local mode**: the Vite development server on your own computer, bound to `127.0.0.1`, editing one project file. Start it from the repository root with `pnpm -r build`, then `pnpm --filter @cindermed/web dev`, and open `http://127.0.0.1:5173`; write the FHIR definitions once with `pnpm cindermed fhir-index <project.json> --out apps/web/.fhir-index`. The production build and the Docker images, `workbench-web:0.4.0` and `latest` included, **do not contain the grid**.

No login, no shared projects and no API storage until module 4: the local mode has no login and must never be exposed on an address other people can reach.

Known limitations:

- #156: on a choice element (`value[x]`), a value whose type is not the chosen one is reported as `TYPE_MISMATCH` and greyed in the path picker, until the generator writes choice elements with an explicit type.
- #194: a cell with `TYPE_NEEDS_TRANSFORM` names the transform to use, but it is set by hand in the transform editor; a one-click fix is planned.
- #98: concatenation is not offered in the transform editor until the FML export can write it; a row that already has one (from a project file) shows a notice, and `cindermed export` refuses it (`TRANSFORM_UNSUPPORTED`).
- Review statuses can be set in bulk, but statuses and comments as a workflow (A5, A6), with who may set them, come with module 4.
