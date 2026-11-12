# ADR-0012: Export package: layout, cleaned project copy, version and deterministic zip

- Status: accepted
- Date: 2026-11-12
- Module: 2 (Generator and package)

## Context

G7 exports a project as a package that the conversion module (V2) can run without the workbench, and G10 checks every map against the official grammar before export. The manifest format is a contract (`manifest.schema.json` 1.0.0). The package leaves the team, so it must carry the mapping and not the collaboration around it. A package must be reproducible: the same input must give the same bytes, so that digests, reviews and caches mean something.

## Decision

- **`@cindermed/export`, `exportPackage(projectText, options)`.** It does no I/O (ADR-0001).
  1. It reads and validates the project: schema and integrity errors block; quality warnings are returned.
  2. For each table: the plan, logical model, normalization specification and map. Generator errors block.
  3. Grammar check (G10): every printed map goes through `@cindermed/fml/grammar`. Errors are traced to the mapping row whose code starts the rule name, and they block.
  4. It writes the files, the manifest and the zip.
- **Backend only.** The package carries the grammar parser (ADR-0008), so dependency-cruiser stops `apps/web` from importing it (`web-no-export`).
- **Layout.**
  - `project.json` (cleaned copy);
  - per table: `<Table>.map`, `StructureMap-<Table>.json`, `StructureDefinition-<Table>Row.json`, `normalization-<Table>.json`;
  - `ConceptMap-<name>.json`;
  - `schemas/mapping-project.schema.json`, `schemas/normalization.schema.json` and `schemas/manifest.schema.json`;
  - `manifest.json`.
- **`$schema`.** References point to the included schemas by relative path, so the package validates offline; the `$id` URLs do not resolve. The golden tests pass the fixtures' own references instead (`../normalization.schema.json`).
- **StructureMap JSON** is what our builder writes (ADR-0007). Its content equals the HL7 compilation; its bytes do not, and the manifest hashes our bytes. `verification.compile` is `skipped`; `verification.grammar` records the source, the commit (`8bb04b4`) and the result.
- **Manifest.**
  - `loadOrder` is a topological sort by levels with alphabetical ties; a cycle is `EXPORT_TABLE_CYCLE`.
  - Tables appear in project order, with `dependsOn` and `creates`.
  - ConceptMaps are sorted by file name.
  - `files` lists every file except the manifest, with SHA-256 (@noble/hashes) and media type.
  - The core package is `hl7.fhir.r4.core#4.0.1` or `hl7.fhir.r5.core#5.0.0`, followed by the project's packages.
- **Version (#83).** The package version is `options.packageVersion`. Without it, it is `0.0.0-dev.<first 12 hex of the SHA-256 of the project text>`, so two different projects never share a dev version. The logical models and ConceptMaps carry the package version, not the project format version. A model therefore changes only when the package does.
- **Cleaned project copy.** The package's `project.json` keeps everything the generator needs, descriptions and labels included. It removes:
  - at any depth: `review` (status, comments, authors, dates), `provenance` (`kind`, `detail`, `acceptedBy`), and Coding `verification` (status, `checkedAt`, `serverDisplay`);
  - at the top: `extensions`;
  - in `project`: `createdAt` and `updatedAt`.

  The copy is still a valid project and gives the same artifacts. The full file stays the H3 project export. A test fills every such field and checks that none survives.

- **Deterministic zip** (fflate 0.8.3, pinned exactly):
  - entries sorted by path;
  - every entry with the same timestamp (`createdAt`), "made by" system 3 (Unix) and attributes (regular file, 0644);
  - compression level 9, no comments or extra fields.

  The ZIP timestamp is written from a Date's local-time fields, so the exporter builds that Date from `createdAt`'s UTC fields. Tests check that two exports are identical, that the central directory fields are fixed, and that the bytes are the same under TZ=UTC, Europe/Rome and Pacific/Kiritimati.

## Consequences

- The fixture manifests are exporter output, with version 0.1.0 and each folder's `createdAt`. They hash our StructureMap JSON, not the HL7 JSON stored next to them in the fixture folder, and they list the three `schemas/` files, which live one level up in the fixtures. The fixture logical models and ConceptMaps carry version 0.1.0.
- A fixed `createdAt` is part of the input. The CLI (`cindermed export`) takes it from the clock unless `--created-at` is given, and the golden tests always pass it.
- When A8 (mapping releases) arrives, it supplies the package version.
