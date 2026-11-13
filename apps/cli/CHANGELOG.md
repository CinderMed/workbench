# @cindermed/cli

## 0.3.0

### Minor Changes

- db6c645: `cindermed validate` checks the project against the FHIR definitions of its version (D7, paths): every role's resource type and profile, and every path the project writes (mapping rows, fixed values, value-map actions, declared slices and their discriminators) — `PATH_NOT_FOUND`, `CHOICE_TYPE_REQUIRED`, `SLICE_NOT_REPEATING`, `EXTENSION_NOT_SUPPORTED`, `PATH_PROHIBITED`, `REPEAT_TARGET_NOT_REPEATING`, `RESOURCE_TYPE_UNKNOWN`, `PROFILE_UNKNOWN`, `PROFILE_TYPE_MISMATCH`. The FHIR packages come from the shared cache `~/.fhir/packages` and are downloaded once when missing; new options `--offline`, `--fhir-cache <folder>` and `--no-fhir`. `@cindermed/fhir-defs` exports `validateFhir` and `loadProjectDefinitions`; `@cindermed/model` exports `rowValueMaps`.

### Patch Changes

- 66425f3: `@cindermed/fhir-defs` builds and reads the compact FHIR definition index (ADR-0013): a manifest of the types and profiles of a FHIR version and its packages, and one small document per type, loaded on demand and checked against its SHA-256. The CLI gains the FHIR package loader (shared `~/.fhir/packages` cache, download from packages.fhir.org with pinned SHA-256 for the core packages, offline mode); no command uses it yet.
- deb01c4: The FHIR package loader refuses tarballs with entries other than files and folders (symbolic and hard links, devices, FIFOs) or with paths outside their folder, limits downloads to 100 MB and extracted packages to 500 MB, and gives up on a registry request after 120 s, each with a clear error and nothing left in the cache.
- Updated dependencies [db6c645]
- Updated dependencies [66425f3]
- Updated dependencies [e7b00e9]
  - @cindermed/fhir-defs@0.1.0
  - @cindermed/model@0.4.0
  - @cindermed/export@0.1.1

## 0.2.0

### Minor Changes

- bbbf421: `cindermed export <project.json>` writes the export package as a deterministic zip or into a folder, with `--out`, `--package-version`, `--created-at` and `--format text|json`; a project with errors is not exported (exit code 1).
- 9b2ed46: `cindermed mapping-table <project.json>` writes the mapping table (H1) as one XLSX workbook (default) or as one CSV file per sheet in a folder, with `--format xlsx|csv`, `--delimiter`, `--out` and `--created-at`. Options that do not apply to a command are rejected.

### Patch Changes

- Updated dependencies [fb6d6a8]
- Updated dependencies [5724d33]
- Updated dependencies [833addf]
- Updated dependencies [9b2ed46]
- Updated dependencies [5ce287c]
- Updated dependencies [2940d8e]
- Updated dependencies [7111d06]
- Updated dependencies [4d77491]
- Updated dependencies [391d212]
- Updated dependencies [5724d33]
  - @cindermed/model@0.3.0
  - @cindermed/export@0.1.0

## 0.1.0

### Minor Changes

- 0f9df12: Add the `cindermed validate <project.json> [--format text|json]` command, with exit codes 0 (valid), 1 (errors) and 2 (could not run).

### Patch Changes

- Updated dependencies [9621442]
- Updated dependencies [baa2634]
- Updated dependencies [0f9df12]
- Updated dependencies [242c717]
  - @cindermed/model@0.2.0
