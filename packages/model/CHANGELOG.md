# @cindermed/model

## 0.6.0

### Minor Changes

- 6b56067: A quantity can take its unit text from a column (project format 1.5.0, #108): `unitColumnId` without `unitValueMapId` writes `src.uom as u -> q.unit = u`, one rule for any number of units, such as MIMIC-IV's `valueuom`. The new optional `unitSystem` also writes the text as the code of that system (`q.system = '<system>', q.code = u`); the schema accepts it only with `unitColumnId` and without `unitValueMapId`. Before, a unit column without a value map wrote no unit. The mapping table names the unit text and its system, and the grid's quantity editor offers "Unit text from a column" with the optional code system.
- 29d3164: Time zones at the border (#107, ADR-0024). Project format 1.5.0 adds an optional `timeZone` on a table and on a column: a fixed offset (`+01:00`, `Z`) or an IANA zone (`Europe/Rome`). Normalization 1.3.0 writes a dateTime with a time with its offset (`2025-01-15T10:00:00+01:00`). An IANA zone's offsets come from the zone's rules in the specification's new `timeZones`, which the export copies from a committed tzdata snapshot (2026e, 1970–2299), so every implementation gives the same result without a time-zone library. A local time in the spring-forward gap is an invalid value; one in the repeated fall-back hour takes the earlier offset. Integrity rule 10 reports a zone the snapshot does not have (`TIME_ZONE_UNKNOWN`, error) and a zone on a column that is not dateTime (`TIME_ZONE_NOT_DATETIME`, warning). Projects without a zone convert as before.
- e625743: The export manifest pins its FHIR packages (manifest format 1.1.0, #146, ADR-0025). `packages` lists every package the definitions were built from, dependencies included, each with the SHA-256 of its tarball. The digest is pinned for the core packages; for the others the CLI computes it at download and keeps it in the package cache (`<id>#<version>/cindermed.json`), downloading the tarball again for a package cached without it. An unknown digest blocks the export with `EXPORT_PACKAGE_DIGEST_MISSING`. The definition index (format 1.2.0) carries the digest of each package as `tarballSha256`. 1.0.0 manifests still validate.
- 3d4a3f1: A `dateTime` column whose values have a time now needs a time zone, its own or its table's: validation reports `TIME_ZONE_MISSING` (error) otherwise. `columnTimeZone` and `takesTimeZone` move to `@cindermed/model` (`@cindermed/fml` no longer exports `columnTimeZone`). The mapping table's Columns sheet shows the time zone of a date-time column in its Format cell.

### Patch Changes

- 5b5460c: Each package now has the metadata a publish needs: `repository`, `homepage`, `bugs`, `engines` (Node 22.12 or later), a README and the LICENSE. Its tarball holds only `dist/` without source maps, its LICENSE and its README. Nothing is published: npm publishing is deferred after the MVP (#199), and every package stays private.

## 0.5.0

### Minor Changes

- 232b1ec: Local mode of the web app (#173, ADR-0021): in the Vite dev server only, bound to 127.0.0.1 (any other address stops the server), the app opens a project file from this computer, keeps it in memory and saves it back object by object through `LocalFileStore`; the production build does not contain it. `@cindermed/model` adds `applyChanges` (create, update and delete of project settings, tables, columns, relations, roles, rows and value maps, refused only when the result would not match the schema), `nextRowCode` and `objectKey`.

### Patch Changes

- 84850af: Third-party dependencies are pinned to the exact versions already in the lockfile (no version changes).

## 0.4.0

### Minor Changes

- 7f23a9a: Coding from a code column (project format 1.4.0, #106, ADR-0019): a new transform `{ kind: "coding", system, as: "Coding" | "CodeableConcept", displayColumnId? }` writes the column's value as the code of a fixed system, with the display from another column when it has a value, as one FML rule with a typed `create` (so choice elements work). Type checks (string, categorical or integer column; `as` must be the element's type), binding checks on the column's allowed values, integrity checks on the display column, and the mapping table describe it.
- db6c645: `cindermed validate` checks the project against the FHIR definitions of its version (D7, paths): every role's resource type and profile, and every path the project writes (mapping rows, fixed values, value-map actions, declared slices and their discriminators) — `PATH_NOT_FOUND`, `CHOICE_TYPE_REQUIRED`, `SLICE_NOT_REPEATING`, `EXTENSION_NOT_SUPPORTED`, `PATH_PROHIBITED`, `REPEAT_TARGET_NOT_REPEATING`, `RESOURCE_TYPE_UNKNOWN`, `PROFILE_UNKNOWN`, `PROFILE_TYPE_MISMATCH`. The FHIR packages come from the shared cache `~/.fhir/packages` and are downloaded once when missing; new options `--offline`, `--fhir-cache <folder>` and `--no-fhir`. `@cindermed/fhir-defs` exports `validateFhir` and `loadProjectDefinitions`; `@cindermed/model` exports `rowValueMaps`.
- 87fe1bd: Profile slice names in element paths (#150, ADR-0020): slice names in `ElementPath` and `Slice.name` may start with an upper-case letter (`[A-Za-z][A-Za-z0-9-]*`, project format 1.4.0), so profile slices such as `category[VSCat]` can be written. `SLICE_NAME_UNUSABLE` (warning) reports a required profile slice whose name a project path cannot hold.
- 911e043: Project file format 1.4.0 (compatible minor version, not released yet): the version only, so that the module-3 contract extensions (Coding from a code column, profile slice names in paths) can extend it. A 1.3.0 file is read as 1.4.0 with its content unchanged.

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
