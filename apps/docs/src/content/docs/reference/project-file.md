---
title: Project file
description: The JSON file that holds a whole mapping project.
---

A project file is one JSON document with the whole mapping project: tables and columns, roles, mapping rows, value maps, templates and review comments. It is the native format of CinderMed. You can export it, keep it in git and import it again.

The format is described by the JSON Schema `mapping-project.schema.json`, format version 1.3.0. The two example projects in the repository are good starting points:

- `fixtures/fml-examples/metastra/project.json`: one table, 11 variables
- `fixtures/fml-examples/motu/project.json`: three tables linked by a relation

Check a file with [`cindermed validate`](/workbench/reference/cli/).

## Format version

`formatVersion` follows semantic versioning:

| File version                         | What happens                                                       |
| ------------------------------------ | ------------------------------------------------------------------ |
| Same major and minor (any patch)     | Read as it is                                                      |
| Same major, older minor (e.g. 1.2.0) | Read as it is; saved again as 1.3.0                                |
| Older major                          | Migrated automatically, one major at a time                        |
| Newer minor or major (e.g. 1.4.0)    | Rejected with `UNSUPPORTED_FORMAT_VERSION`: update CinderMed first |

## Data formats

Inside CinderMed every value has one form: dates in ISO 8601 (`2023-09-17`), decimals with a point (`11.20`), booleans `true`/`false`. Local formats are declared on the column, so the conversion can translate them when it reads the data file:

- `dateFormat`: the date pattern in the file, for example `dd/MM/yyyy`
- `decimalSeparator`: `.` (default) or `,` for values such as `11,20`

A column of type `boolean` accepts only `true`/`false`, `1`/`0`, `yes`/`no` and `y`/`n`, in any case. Booleans written as words in another language, such as `Sì`/`No`, are a `categorical` column with a value map to `boolean`. `cindermed validate` reports `ALLOWED_VALUE_TYPE_MISMATCH` when an allowed value does not fit its column: `Sì` in a `boolean` column, `11,20` in a decimal column without `decimalSeparator: ","`, or `31/02/2023` in a date column.

`project.output.onInvalidValue` sets what the conversion does with a value that does not fit its column, such as `31/02/2023` in a date column:

| Value            | What happens                                                |
| ---------------- | ----------------------------------------------------------- |
| `fail` (default) | The conversion stops at the first such value and reports it |
| `report-drop`    | The value is left out and reported                          |
| `reject-row`     | The whole row is left out and reported                      |

Projects saved before format 1.3.0 have no `onInvalidValue`, so they use `fail`.

## Written files

CinderMed always writes a project in the same way, so that saving an unchanged project gives the same text and git diffs show only real changes:

- the keys of each object follow the order of the schema (for example `id` first), and keys the schema does not name, such as those inside `extensions`, follow in alphabetical order
- lists keep their order
- two-space indentation and a final newline

The order of keys in a file you write by hand does not matter: CinderMed reads it and writes it back in this order.
