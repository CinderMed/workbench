# ADR-0009: Table plan, element names and id fields

- Status: accepted
- Date: 2026-11-11
- Module: 2 (Generator and package)

## Context

G1 generates, for each table, the logical model of the normalized row and the normalization specification. Both must agree with the FML map of the table, which comes later in the module. The specification fixes the element-name rule and the normalization algorithm ("Generator contract"). The verified examples fix the output, written by the prototype `tools/artifacts.py`.

The prototype leaves a few cases open or handles them silently:

- Names are cut to 64 characters only on a collision.
- A column can take the name of an id field (`id_Patient0`).
- Literal parts of an `idRule` that follow a column part are moved to the front.
- An `idRule` without column parts gives a specification the schema rejects.
- A role without `idRule` makes it fail.
- Empty labels give empty FHIR strings.

## Decision

- **One plan per table.** `planTable(project, sourceId)` computes the element name of each column and the id fields of the row. The logical model, the normalization specification and (later) the FML are all built from it, so they always use the same names.
- **Element names** follow the specification's rule, applied per code point. Names are cut to 64 characters (the limit of `ElementName` in normalization.schema.json). A collision gets a numeric suffix on the first 60 characters. Id field names (`id_<Type><index>`) are fixed by the contract, so they are reserved first and a column that would take one gets the suffix instead.
- **Id fields** come in the prototype's order: the table's own roles in project order, then the roles in other tables referenced by its rows, in row order. A referenced role's id uses the columns of this table that the `via` relation pairs with the target's `idRule` columns.
- **Generator results.** Some features pass the schema and the integrity rules but cannot be translated. The generator returns them as error results with stable codes, which block the export:
  - `SOURCE_NAME_NOT_FML_NAME`: the table name is not `^[A-Za-z][A-Za-z0-9]*$`. It names the map, its main group and the logical model.
  - `MULTI_VALUE_EXPANDED_UNSUPPORTED`: `expanded` multiple choices (B9, V2); the specification already says the export rejects them.
  - `ROLE_WITHOUT_ID_RULE`: a role with no id can never be created.
  - `ID_RULE_WITHOUT_COLUMNS`: every row would get the same id, and the normalization schema needs at least one column.
  - `ID_LITERAL_AFTER_COLUMN`: the normalization writes literals first, then the encoded columns. The prototype silently reordered them.
- **Broken projects throw.** A project that breaks the integrity rules (an unknown source, role or relation, or an unreachable id column) throws `GeneratorInputError`. The export validates the project before generating.
- **No empty strings.** An empty description or label falls back to the next value, ending with the element name, because FHIR does not allow empty strings.
- **Normalization `input`** uses the schema defaults (CSV, `,`, UTF-8, header row 1), as in the prototype. The project's import profile may describe the dictionary file, not the data file. The conversion module can override `input` at run time.
- **`$schema`** is written only when the caller passes `schemaRef`. The verified examples use `../normalization.schema.json`, which is valid only inside `fixtures/`. The export (G7) chooses the value for its package.
- The verified logical models and normalization specifications are reproduced **byte for byte** with `JSON.stringify(value, null, 2)` (tested).

## Consequences

- The FML generator (branch `feature/g2-generator-roles`) takes element names and id fields from the plan instead of recomputing them.
- The project schema 1.2.0 has no `decimalSeparator`, `trueValues` or `falseValues` on columns. The normalization supports them, but the generator cannot emit them, so Italian decimals (`11,20`) and booleans (`Sì`/`no`) cannot yet be described from a project. Adding them is a contract change (project schema 1.3.0, a compatible minor version) and needs approval.
- New generator codes are added to `GeneratorCode` and documented when the export shows them to users.
