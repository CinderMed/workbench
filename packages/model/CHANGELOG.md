# @cindermed/model

## 0.4.0

### Minor Changes

- db6c645: `cindermed validate` checks the project against the FHIR definitions of its version (D7, paths): every role's resource type and profile, and every path the project writes (mapping rows, fixed values, value-map actions, declared slices and their discriminators) — `PATH_NOT_FOUND`, `CHOICE_TYPE_REQUIRED`, `SLICE_NOT_REPEATING`, `EXTENSION_NOT_SUPPORTED`, `PATH_PROHIBITED`, `REPEAT_TARGET_NOT_REPEATING`, `RESOURCE_TYPE_UNKNOWN`, `PROFILE_UNKNOWN`, `PROFILE_TYPE_MISMATCH`. The FHIR packages come from the shared cache `~/.fhir/packages` and are downloaded once when missing; new options `--offline`, `--fhir-cache <folder>` and `--no-fhir`. `@cindermed/fhir-defs` exports `validateFhir` and `loadProjectDefinitions`; `@cindermed/model` exports `rowValueMaps`.

## 0.3.0

### Minor Changes

- fb6d6a8: Add integrity rule 9 (`ALLOWED_VALUE_TYPE_MISMATCH`): the allowed values of a column must fit its type, and export the cell parsers shared with the normalization.
- 5724d33: Rule 9 reports a categorical or multiple-choice column whose allowed values are empty once missing values are removed (`ALLOWED_VALUES_EMPTY`); the normalization schema requires at least one allowed value, and the generator refuses to write an empty list.
- 2940d8e: Normalization format 1.2.0: the generator writes the allowed values of categorical and multiple-choice columns into the normalization specification, and a value outside the list is an invalid value (`onInvalidValue` applies). Rule 6 reports a categorical or multiple-choice column used by a value map without allowed values (`VALUE_MAP_COLUMN_WITHOUT_ALLOWED_VALUES`), and the new quality level warns about such columns without a value map (`ALLOWED_VALUES_MISSING`).
- 4d77491: Project format 1.3.0 adds a column's `decimalSeparator` and `project.output.onInvalidValue` (default `fail`); normalization format 1.1.0 adds `onInvalidValue: fail`. The generator writes both into every normalization specification.
- 5724d33: Rule 6 reports a value map without an entry for an allowed value of a column that uses it (`VALUE_MAP_INCOMPLETE`; an entry with an action counts), and a value map used by a column that is not categorical, multipleChoice or boolean (`VALUE_MAP_COLUMN_TYPE_NOT_ALLOWED`).

### Patch Changes

- 7111d06: First release of the reference normalizer: `normalize(spec, input, options)` turns CSV text or bytes into normalized rows and issues (normalization 1.2.0), with SHA-256 or HMAC-SHA256 ids, WHATWG decoding, `serializeRows` byte-identical to the reference `normalize.mjs`, and the CSV reader `parseCsv`. The normalization schema describes the WHATWG decoding of `input.encoding`.
- 391d212: The decimal separator is strict: with `decimalSeparator: ","` a value containing `.` (`1.234`, `1.234,5`) is not a decimal, and with `.` a value containing `,` is not. Rule 9 (`ALLOWED_VALUE_TYPE_MISMATCH`) reports such allowed values.

## 0.2.0

### Minor Changes

- 9621442: Add `checkIntegrity` with integrity rules 1–3 (unique ids and valid references, unique role keys and row codes, columns from the right table) and their stable `IntegrityCode` result codes.
- baa2634: Check integrity rules 4–8 (structural parts): declared slices, reachable references, value map source values, resource id length and characters, `repeat: eachValue` on multiple-choice columns. Export `MAX_ID_LENGTH` and `idLength`.
- 0f9df12: Read and write the JSON project file (H3): `parseProject` (JSON, format version, schema and integrity checks), `serializeProject` (canonical schema key order), `validateProject`, `migrateProject` with the `PROJECT_MIGRATIONS` registry, and the `ProjectFileCode` result codes `INVALID_JSON` and `UNSUPPORTED_FORMAT_VERSION`.
- 242c717: Export TypeScript types generated from the JSON Schemas (`ProjectFile` and its parts, `NormalizationSpec`, `ExportManifest`) and the type guards `isProjectFile`, `isNormalizationSpec` and `isExportManifest`.

## 0.1.0

### Minor Changes

- 5704d2e: Add the project (1.2.0), normalization (1.0.0) and manifest (1.0.0) JSON Schemas with Ajv validators that return results in the shared `{severity, code, objectKind, id, field, message}` shape.
