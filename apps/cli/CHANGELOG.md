# @cindermed/cli

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
