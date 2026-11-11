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
