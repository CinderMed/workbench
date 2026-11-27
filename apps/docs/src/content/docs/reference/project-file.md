---
title: Project file
description: The JSON file that holds a whole mapping project.
---

A project file is one JSON document with the whole mapping project: tables and columns, roles, mapping rows, value maps, templates and review comments. It is the native format of CinderMed. You can export it, keep it in git and import it again.

The format is described by the JSON Schema `mapping-project.schema.json`, format version 1.5.0. The two example projects in the repository are good starting points:

- `fixtures/fml-examples/metastra/project.json`: one table, 11 variables
- `fixtures/fml-examples/motu/project.json`: three tables linked by a relation

Check a file with [`cindermed validate`](/workbench/reference/cli/).

## Format version

`formatVersion` follows semantic versioning:

| File version                         | What happens                                                       |
| ------------------------------------ | ------------------------------------------------------------------ |
| Same major and minor (any patch)     | Read as it is                                                      |
| Same major, older minor (e.g. 1.2.0) | Read as it is; saved again as 1.5.0                                |
| Older major                          | Migrated automatically, one major at a time                        |
| Newer minor or major (e.g. 1.6.0)    | Rejected with `UNSUPPORTED_FORMAT_VERSION`: update CinderMed first |

## Data formats

Inside CinderMed every value has one form: dates in ISO 8601 (`2023-09-17`), decimals with a point (`11.20`), booleans `true`/`false`. Local formats are declared on the column, so the conversion can translate them when it reads the data file:

- `dateFormat`: the date pattern in the file, for example `dd/MM/yyyy`
- `decimalSeparator`: `.` (default) or `,` for values such as `11,20`. The separator is strict and there are no thousands separators: in a `,` column, `1.234` and `1.234,5` are invalid values (`1.234` is a thousands separator in Italian data, so it is never read as 1.234); in a `.` column, `1,234` is invalid.
- `timeZone` (format 1.5.0): the time zone of the file's date-times, on the table or on one `dateTime` column (a column's own one wins). See "Time zones" below.

A column of type `boolean` accepts only `true`/`false`, `1`/`0`, `yes`/`no` and `y`/`n`, in any case. Booleans written as words in another language, such as `Sì`/`No`, are a `categorical` column with a value map to `boolean`. `cindermed validate` reports `ALLOWED_VALUE_TYPE_MISMATCH` when an allowed value does not fit its column: `Sì` in a `boolean` column, `11,20` in a decimal column without `decimalSeparator: ","`, or `31/02/2023` in a date column.

The allowed values of a `categorical` or `multipleChoice` column are also checked during conversion: a value that is not in the list, compared case-sensitively after trimming spaces, does not fit its column. In a column with `Sì` and `No`, the value `sì` is not allowed. This is why a `categorical` or `multipleChoice` column used by a value map must have allowed values (`VALUE_MAP_COLUMN_WITHOUT_ALLOWED_VALUES`, an error): otherwise a value without a rule in the map would be lost silently. A column with no allowed values and no value map only gets a warning (`ALLOWED_VALUES_MISSING`), because its values will not be checked. A list that is empty, or holds only missing values, is an error (`ALLOWED_VALUES_EMPTY`): it would reject every value.

A value map can be used only by a `categorical`, `multipleChoice` or `boolean` column (`VALUE_MAP_COLUMN_TYPE_NOT_ALLOWED` otherwise: declare the column categorical), and it needs an entry for every allowed value of the column that is not a missing value (`VALUE_MAP_INCOMPLETE`). An entry can give a code or an action: skip the resource (`skipInstance`), set another element (`setElement`) or treat the value as missing (`absent`).

`project.output.onInvalidValue` sets what the conversion does with a value that does not fit its column, such as `31/02/2023` in a date column or `sì` in a column that allows only `Sì` and `No`:

| Value            | What happens                                                |
| ---------------- | ----------------------------------------------------------- |
| `fail` (default) | The conversion stops at the first such value and reports it |
| `report-drop`    | The value is left out and reported                          |
| `reject-row`     | The whole row is left out and reported                      |

Projects saved before format 1.3.0 have no `onInvalidValue`, so they use `fail`.

## Time zones

A FHIR `dateTime` with a time must have an offset, such as `2025-01-15T10:00:00+01:00`, but data files usually write only `15/01/2025 10:00`. The zone the times were written in is declared once, on the table, or on a column whose zone differs:

```json
{ "id": "src_visit", "name": "Visit", "timeZone": "Europe/Rome", "columns": [ … ] }
```

- A **fixed offset** (`+01:00`, `-05:00`, `Z`) is added as it is (`Z` as `+00:00`).
- An **IANA zone** (`Europe/Rome`, `America/New_York`) gives each time the offset in force on that day: `+01:00` in January and `+02:00` in July in Rome.
- On the day clocks go forward, a time in the skipped hour (`30/03/2025 02:30` in Rome) does not exist: it is an invalid value, handled by `onInvalidValue`. On the day they go back, a time in the repeated hour (`26/10/2025 02:30`) takes the earlier offset, `+02:00`.
- Only `dateTime` columns whose format has a time get an offset; a date stays a date. Such a column must have a zone, its own or its table's (`TIME_ZONE_MISSING`, an error), because FHIR requires the offset and the workbench never guesses one. A `dateTime` column without `dateFormat` has a time (the default is `yyyy-MM-ddTHH:mm:ss`), so it needs a zone too.
- A zone the workbench does not know is an error (`TIME_ZONE_UNKNOWN`), and a zone on a column that is not `dateTime` is a warning (`TIME_ZONE_NOT_DATETIME`).

The offsets of IANA zones come from a tzdata snapshot in the workbench (tzdata 2026e, years 1970 to 2299), copied into each exported normalization specification with its version, so a package converts the same way on every machine. A time outside those years, with an IANA zone, is an invalid value; data with shifted dates can declare a fixed offset instead.

## Written files

CinderMed always writes a project in the same way, so that saving an unchanged project gives the same text and git diffs show only real changes:

- the keys of each object follow the order of the schema (for example `id` first), and keys the schema does not name, such as those inside `extensions`, follow in alphabetical order
- lists keep their order
- two-space indentation and a final newline

The order of keys in a file you write by hand does not matter: CinderMed reads it and writes it back in this order.
