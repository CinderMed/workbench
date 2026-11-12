---
title: Command line
description: The cindermed command, its subcommands and their exit codes.
---

`cindermed` checks project files and writes their export packages and mapping tables from a terminal or a CI job, without the web app.

## Run it from the repository

The command is not published to npm yet. Build the packages once, then run it with pnpm from the repository root:

```bash
pnpm install
pnpm -r build
pnpm cindermed validate fixtures/fml-examples/motu/project.json
```

Relative paths are resolved from the repository root.

## `cindermed validate`

```text
cindermed validate <project.json> [--format text|json]
```

Reads a [project file](/workbench/reference/project-file/) and runs three levels of project validation:

1. **Schema**: the file matches the project JSON Schema.
2. **Integrity**: the nine rules the schema cannot express (unique ids, internal references, `via` relations, value map values, resource id length, `repeat`, allowed values that fit the column type). They run only when the schema check passes.
3. **Quality**: warnings that do not make the project invalid. The first one is `ALLOWED_VALUES_MISSING`: a `categorical` or `multipleChoice` column without allowed values, whose values will not be checked during conversion. It also runs only when the schema check passes.

The FHIR checks (paths, types, cardinality) come in a later version.

A valid project prints one line:

```text
$ pnpm cindermed validate fixtures/fml-examples/metastra/project.json
fixtures/fml-examples/metastra/project.json: valid (format 1.3.0)
```

An invalid project lists one line per problem: severity, code, object kind and id, field inside the object, and the message.

```text
broken.json: 1 error
  error DUPLICATE_ROW_CODE mapping map_02 (code): row code R-001 is already used by map_01
```

The codes are stable, so scripts can rely on them.

### JSON output

`--format json` prints a report for scripts:

```json
{
  "file": "fixtures/fml-examples/motu/project.json",
  "valid": true,
  "formatVersion": "1.3.0",
  "results": []
}
```

Each item of `results` has the fields `severity`, `code`, `objectKind`, `id`, `field` and `message`. The report also has `migratedFrom` when the file was written in an older format.

## `cindermed export`

```text
cindermed export <project.json> [--out <file.zip|folder>] [--package-version <x.y.z>]
                 [--created-at <date-time>] [--format text|json]
```

Writes the export package of a project: everything a conversion tool needs to turn the data files into FHIR, without the workbench.

| File                                          | Content                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `project.json`                                | The project, without reviews, comments, authors, provenance and other collaboration data |
| `<Table>.map` and `StructureMap-<Table>.json` | The FHIR Mapping Language map of each table, as text and as a StructureMap resource      |
| `StructureDefinition-<Table>Row.json`         | The logical model of the normalized row the map reads                                    |
| `normalization-<Table>.json`                  | How to turn each row of the data file into that normalized row                           |
| `ConceptMap-<name>.json`                      | One per value map, as documentation (value maps to `true`/`false` have none)             |
| `schemas/`                                    | The three JSON Schemas the files above refer to                                          |
| `manifest.json`                               | Tables, load order, versions, the grammar check result and the SHA-256 of every file     |

The project is validated first, as `validate` does. Every map is then checked against the official FHIR Mapping Language grammar. If there is any error, nothing is written and the errors are listed as with `validate`.

```text
$ pnpm cindermed export fixtures/fml-examples/motu/project.json --package-version 0.1.0 --out motu.zip
fixtures/fml-examples/motu/project.json: exported motu-mapping 0.1.0 to motu.zip (18 files)
```

- `--out`: a path ending in `.zip` writes a zip; any other path writes the files into that folder. Without `--out`, the zip is `<name>-mapping-<version>.zip` in the current folder.
- `--package-version`: the version of the package, also written into the logical models and ConceptMaps. Without it, the version is `0.0.0-dev.` followed by 12 characters of the project file's SHA-256, so two different projects never share a version.
- `--created-at`: the date of the package, ISO 8601 with a time zone (for example `2026-11-12T00:00:00Z`). Without it, the current time is used.

The same project, version and date always give the same zip, byte for byte, on any machine.

### JSON output

`--format json` prints `file`, `ok`, `out`, `package` (name, version, date, generator), the list of `files` and the `warnings`. A blocked export prints `ok: false` and the `results`.

## `cindermed mapping-table`

```text
cindermed mapping-table <project.json> [--format xlsx|csv] [--delimiter <char>]
                        [--out <file.xlsx|folder>] [--created-at <date-time>]
```

Writes the mapping table of a project, a flat view for documentation and review, in the style of Table 1 of the MOTU paper. It has four sheets:

| Sheet      | One line per                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| Mapping    | Mapping row: column, role, element, transform, condition, notes and review status                          |
| Value maps | Entry of every value map, including maps to `true`/`false`: target, code verification, action              |
| Roles      | Role: description, how many resources, when they are created, id rule, fixed values and their verification |
| Columns    | Source column: description, type, formats, allowed and missing values, and the rows and roles that use it  |

The table shows review statuses and notes, but not who reviewed, the comments or where an object came from.

```text
$ pnpm cindermed mapping-table fixtures/fml-examples/metastra/project.json
fixtures/fml-examples/metastra/project.json: wrote the mapping table to metastra-mapping-table.xlsx
   16 Mapping
   17 Value maps
    6 Roles
   11 Columns
```

- `--format xlsx` (the default) writes one workbook. **For Excel, use XLSX**: it opens with the right characters and columns whatever the language settings.
- `--format csv` writes one file per sheet into a folder (`mapping.csv`, `value-maps.csv`, `roles.csv`, `columns.csv`). The files are UTF-8 with a byte order mark and Windows line ends. The delimiter is a comma; use `--delimiter ";"` for Excel set to Italian or another language whose list separator is `;`. A cell that a spreadsheet would read as a formula (starting with `=`, `+`, `@`, or `-` not followed by a digit) starts with `'`.
- `--out`: the workbook or folder to write. Without it: `<name>-mapping-table.xlsx`, or the folder `<name>-mapping-table`.
- `--created-at`: the document date of the workbook; without it, the current time. The same project and date give the same file, byte for byte.

The project must match the schema. A project with integrity errors or quality warnings still gets its table, because the table helps to review exactly those projects; the findings are listed after the summary.

## Exit codes

| Code | Meaning                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------- |
| 0    | The project is valid (`validate`), or the package or table was written (`export`, `mapping-table`) |
| 1    | The project has errors, including a file that is not JSON; `export` writes nothing                 |
| 2    | The command could not run: wrong arguments, or a file it cannot read or write                      |
