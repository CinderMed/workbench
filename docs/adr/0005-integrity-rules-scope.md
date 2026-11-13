# ADR-0005: Scope and interpretation of the integrity rules

- Status: accepted
- Date: 2026-11-11
- Module: 1 (Domain core)

## Context

The specification lists 8 "rules the schema cannot express" (section "Project JSON Schema") and the "Integrity" validation level that checks them (section "Project validation"). Module 1 is done when every integrity rule has a positive and a negative test. Some rules need the FHIR definitions (`packages/fhir-defs`), which arrive in module 3. Others leave details open: which objects carry ids, which direction a value map must match, how long a hashed id is.

## Decision

**General.**

- `checkIntegrity(project)` runs on a project that already passed the JSON Schema. It returns `ValidationResult`s with severity `error` and the stable codes of `IntegrityCode`, without duplicates.
- Each result points to the top-level object the grid shows (source, column, relation, role, row, value map, template). `field` is the dotted path inside that object, e.g. `slices.0.id` or `transform.via`.
- Rules tolerate each other's failures. A dangling reference is reported only by rule 1, and the other rules skip it.

**Split with module 3.** Module 1 checks only the structural part of rules 4, 5 and 8. The rest needs the StructureDefinitions and moves to D7 and F4 (module 3):

| Rule | Module 1 (structural)                                                                                                       | Module 3 (FHIR definitions)                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 4    | Slices used in a path are declared in the role, with the same element path                                                  | The path exists; a slice sits on an element with max cardinality > 1                         |
| 5    | Target id rule reachable: same table, or a `via` relation that links the two tables and provides the target id rule columns | Target type allowed by `targetProfile`; towards a `perValue` role the source element repeats |
| 8    | `repeat: eachValue` only on rows whose column is `multipleChoice`                                                           | The target element repeats                                                                   |

The `perValue` part of rule 5 has no structural half. A reference row has no column, so it cannot use `repeat: eachValue` (rule 8). "The source element repeats" is therefore entirely a FHIR check.

**Rule 1.**

- Ids are collected from every object that has one: the project, sources, sections, columns, relations, roles, slices, mapping rows, value maps, templates, template applications and comments.
- The first object in file order keeps an id, and every later one is reported as `DUPLICATE_ID`.
- An `…Id` field is `DANGLING_REFERENCE` when no object has the id, and `WRONG_REFERENCE_KIND` when none of the objects with that id has the expected kind.

**Rule 2.** Codes `DUPLICATE_INSTANCE_KEY` (on `index`) and `DUPLICATE_ROW_CODE` (on `code`), reported on the later object.

**Rule 3.**

- "A row and its role belong to the same table" is read as: every column a row reads belongs to the table of its role. That covers `columnId`, the unit column, concat columns and condition columns.
- The same check, with the same code `SOURCE_MISMATCH`, covers:
  - every column a role reads (multiplicity, `createWhen`, `idRule`)
  - the row key of a table
  - the columns of each side of a relation
  - the section of a column
- Reference rows read no columns. A target role in another table is rule 5, which is where `via` applies.

**Rule 5.**

- A target in the same table is always reachable.
- A target in another table needs `via` (`REFERENCE_NEEDS_VIA`). The relation must link the row's table and the target's table, in either direction (`VIA_RELATION_MISMATCH`). Its columns on the target side must include every column of the target `idRule` (`ID_RULE_NOT_REACHABLE`).
- A target without an `idRule` is not checked here.

**Rule 6.**

- A column uses a value map through a `valueMap` transform (the row's column) or a `quantity` transform (`unitColumnId` with `unitValueMapId`).
- Every `sourceValue` must be an allowed value or a missing-value code of each column that uses the map (`VALUE_MAP_SOURCE_VALUE_UNKNOWN`).
- Columns without `allowedValues` are not checked.
- Allowed values with no entry in the map are not an integrity error. If needed, they belong to the "Quality" level as a warning.

**Rule 7.**

- The id follows the normalization contract (`IdField`): the literal parts, then the encoded column values, joined by the separator (default `-`).
- With `hash` all columns become one hash of `hashLength` characters (default 24), so the length is exact.
- With `sanitize` the length depends on the data, so the check uses the lower bound: one character per column, each column its own piece.
- Longer than 64 characters is `ID_TOO_LONG`. A literal or separator with characters outside `[A-Za-z0-9.-]` is `ID_INVALID_CHARACTERS`.

**Rule 8.** A row with `repeat: eachValue` and no column, or with a column that is not `multipleChoice`, is `REPEAT_REQUIRES_MULTIPLE_CHOICE`.

## Consequences

- Module 1's "every integrity rule has a positive and a negative test" applies to the structural parts above. The FHIR parts get their tests with D7 and F4 in module 3.
- Result codes are a contract with the clients (grid, CLI). New checks add codes, and existing codes are never renamed.
- A `sanitize` id that passes rule 7 can still be too long for some data. The normalizer reports those rows when it computes the ids.
- Revisit rule 6 if real projects need value maps shared by columns with different allowed values.

## Addendum (2026-11-11): rule 9, allowed values fit the column type

Project format 1.3.0 declares locale at the border (ADR-0009 addendum), so a column's allowed values must be convertible to the column's type. Otherwise the conversion would stop (`onInvalidValue: fail`) or lose data.

- **Rule 9**, error level (it blocks the export), code `ALLOWED_VALUE_TYPE_MISMATCH`, objectKind `column`, field `allowedValues.N.code`:
  - `boolean`: only the canonical forms of the normalization (`true`/`false`, `1`/`0`, `yes`/`no`, `y`/`n`, case-insensitive). The message suggests "categorical + value map" for words such as `Sì`/`No`.
  - `integer`: an integer.
  - `decimal`: a number with the column's `decimalSeparator` (default `.`).
  - `date` and `dateTime`: a valid date (calendar check) that matches `dateFormat`, ISO when absent.
  - `string`, `categorical` and `multipleChoice` are not checked.
- A value is first canonicalized as the normalization does (NFC, trim). Empty values and values in `missingValues` are skipped.
- **Shared parsers.** The check uses the cell parsers in `@cindermed/model` (`src/values/`). They are an exact port of the reference normalizer `tools/normalize.mjs`, proved by a differential test that runs the same values through both. The normalizer package (#75) imports the same parsers, so the rule and the conversion cannot disagree. They live in `model` because `normalizer` depends on `model`, so the reverse import would be a cycle.
- The decimal separator is strict (decided in #89, ADR-0009 addendum "strict decimal separator"): in a `,` column a value with `.` (`1.234`, `11.20`) does not fit, so rule 9 reports it.

## Addendum (2026-11-11): value-map columns need allowed values; first quality check

Normalization 1.2.0 (ADR-0009 addendum "allowed values in the normalization") rejects a value that is not in a column's allowed values. That protects a value map only if its column has a list. This addendum revises rule 6.

- **Rule 6, new code `VALUE_MAP_COLUMN_WITHOUT_ALLOWED_VALUES`**, error level (it blocks the export), objectKind `column`, field `allowedValues`. A `categorical` or `multipleChoice` column that a value map uses, through a `valueMap` transform or as the unit column of a `quantity`, must have allowed values. Without them, a value with no rule in the map would be lost silently. It is reported once per column, whatever the number of rows. Rule 6 used to skip such columns without a result.
- Columns of other types used by a value map are not checked by this rule.
- **Quality level, first check**, code `ALLOWED_VALUES_MISSING`, warning (it does not block the export). A `categorical` or `multipleChoice` column without allowed values that no value map uses gets the warning "values will not be checked during conversion". A column used by a value map gets the rule 6 error instead, never both.
- **Where.** The quality checks live in `@cindermed/model` (`src/quality/`, `checkQuality`, `QualityCode`), next to the integrity rules. `validateProject` and `parseProject` return the integrity errors, then the quality warnings. Both run only after the schema check passes. `cindermed validate` already counts warnings separately and exits 0 when there are only warnings. The other quality checks of the specification come with the modules that need them.
- **Next.** Rule 6 is revised again by #91: every allowed value not in `missingValues` must have an entry in each value map that uses the column.

## Addendum (2026-11-11): value-map coverage, value-map column types, empty lists

This addendum revises rule 6 again (#91) and extends rule 9. All results are errors, so they block the export.

- **Coverage, `VALUE_MAP_INCOMPLETE`** (rule 6, objectKind `valueMap`, field `entries`). Every allowed value of a column that is not in its `missingValues` must have an entry in each value map that the column uses. The entry may carry a code or an action (`skipInstance`, `setElement`, `absent`): any entry counts. Values are compared as the normalization compares them, after NFC and trim and case-sensitive. The result lists the uncovered values and is reported once per map and column. With normalization 1.2.0 rejecting values outside the list, this closes the last way a value is lost silently: a listed value with no rule in the map.
- **Column types, `VALUE_MAP_COLUMN_TYPE_NOT_ALLOWED`** (rule 6, objectKind `mapping`, field `columnId` or `transform.unitColumnId`). Only `categorical`, `multipleChoice` and `boolean` columns can use a value map. A `string`, `integer` or other column has no list of values to map. The message suggests declaring the column categorical, with its allowed values. The type-compatibility table of the specification (Value map row) says the same. No verified example is affected.
- A `boolean` column used by a value map needs no allowed values: the normalization already accepts only the canonical forms. When it has a list, the coverage rule applies to it too.
- **Empty list, `ALLOWED_VALUES_EMPTY`** (rule 9, objectKind `column`, field `allowedValues`). A `categorical` or `multipleChoice` column with `allowedValues: []`, or with only values that are also missing values, has no list left for the normalization, and an empty list would reject every value. The normalization schema 1.2.0 requires at least one allowed value, and the generator refuses to write an empty list.
- The consequence "Revisit rule 6 if real projects need value maps shared by columns with different allowed values" still holds. A shared map must now cover the allowed values of every column that uses it.

## Addendum (2026-11-13): the FHIR half of rules 4 and 8 (D7, module 3)

The FHIR half of rules 4 and 8 is implemented in `validateFhir(project, defs)` in `@cindermed/fhir-defs`. Path resolution is decided in ADR-0014. The checks run on definitions of the project's FHIR version that have every document they need loaded. In the browser, `loadProjectDefinitions` loads those documents first.

- **Which paths.** The uses rule 4 lists: mapping rows, fixed values, and the elements set by value actions (`setElement`, and `also` on `use`) in the role of each row that uses the map. Also checked: each declared slice (`path[name]`) and each of its discriminator paths.
- **Rule 4.** A path must resolve in the role's profile, or else in its resource type: `PATH_NOT_FOUND`, `CHOICE_TYPE_REQUIRED`, `SLICE_NOT_REPEATING`, `EXTENSION_NOT_SUPPORTED`, `PATH_PROHIBITED`.
- **Rule 8.** With `repeat: eachValue`, the element at the **end** of the path must repeat (`REPEAT_TARGET_NOT_REPEATING`, field `repeat`). The generator writes one repetition of that element per value. A repeating ancestor is not enough, because each value would otherwise overwrite the same single-valued element.
- **Roles.**
  - `RESOURCE_TYPE_UNKNOWN`: the type is not a resource type of the version. That role's paths are not checked.
  - `PROFILE_UNKNOWN`: the profile is not in the core package or the listed packages.
  - `PROFILE_TYPE_MISMATCH`: the profile does not constrain the role's type.

  With an unknown or mismatched profile, the paths are still checked, on the base resource type.

- **Reported once.** A value-map path used by several rows of the same role is reported once, on the value map.
- **Missing definitions.** A definition that is not loaded gives `DEFINITION_NOT_LOADED`. A check is never skipped silently.
- **Other version.** Definitions of another FHIR version give one `FHIR_VERSION_MISMATCH` and nothing else.
- **`cindermed validate`.**
  - It runs the FHIR level whenever the schema passes, even with integrity errors.
  - It loads the core package and `project.packages`. The options are `--offline` (never download), `--fhir-cache <folder>` and `--no-fhir` (skip, with a note in the output).
  - Definitions that cannot be loaded stop the command with exit code 2, because the project's validity is then unknown.
  - The JSON report records `fhir.checks` (`done`, `skipped`, `not run`) and the packages read.
- **Not yet.** `cindermed export` does not run the FHIR level yet. It joins with type compatibility (D7, next branch), whose errors block the export as the specification says.
- **Rule 5** (reference targets, `perValue` sources) is F4, a later branch.
