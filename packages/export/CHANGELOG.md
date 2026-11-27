# @cindermed/export

## 0.3.0

### Minor Changes

- cd92662: The #156 cells that now have a golden case are turned back on: copies, casts, constants and fixed values on a choice element (written with the chosen type), a quantity on a choice chosen as Age, a path through a choice and element names such as `doseQuantity`. Still turned off, with no golden case: a value map to `code` on a choice, a reference on a choice, other types derived from Quantity, and Quantity constants.
- 6b56067: A quantity can take its unit text from a column (project format 1.5.0, #108): `unitColumnId` without `unitValueMapId` writes `src.uom as u -> q.unit = u`, one rule for any number of units, such as MIMIC-IV's `valueuom`. The new optional `unitSystem` also writes the text as the code of that system (`q.system = '<system>', q.code = u`); the schema accepts it only with `unitColumnId` and without `unitValueMapId`. Before, a unit column without a value map wrote no unit. The mapping table names the unit text and its system, and the grid's quantity editor offers "Unit text from a column" with the optional code system.
- 29d3164: Time zones at the border (#107, ADR-0024). Project format 1.5.0 adds an optional `timeZone` on a table and on a column: a fixed offset (`+01:00`, `Z`) or an IANA zone (`Europe/Rome`). Normalization 1.3.0 writes a dateTime with a time with its offset (`2025-01-15T10:00:00+01:00`). An IANA zone's offsets come from the zone's rules in the specification's new `timeZones`, which the export copies from a committed tzdata snapshot (2026e, 1970–2299), so every implementation gives the same result without a time-zone library. A local time in the spring-forward gap is an invalid value; one in the repeated fall-back hour takes the earlier offset. Integrity rule 10 reports a zone the snapshot does not have (`TIME_ZONE_UNKNOWN`, error) and a zone on a column that is not dateTime (`TIME_ZONE_NOT_DATETIME`, warning). Projects without a zone convert as before.
- cd92662: The generator takes element names and choice types from the FHIR definitions instead of a fixed list of names (#156, ADR-0023). `generateMap(project, plan, written)` gets them as plain data, which `@cindermed/export` resolves with `@cindermed/fhir-defs` for every path the generator writes (`pathsToWrite`). On a choice element, a value whose type is not the chosen one is written with that type (`res.value = create('string') as x, x.value = v`), and a type derived from Quantity, or a path through a choice, is opened with its type (`create('Age')`, `create('Quantity') as p`). No existing map changes. `exportPackage` now requires `definitions`, and `cindermed export` always loads them: `--no-fhir` applies to `validate` only, and the export stops with the reason when the FHIR packages cannot be loaded. The cells of #156 stay turned off until their golden cases.
- e625743: The export manifest pins its FHIR packages (manifest format 1.1.0, #146, ADR-0025). `packages` lists every package the definitions were built from, dependencies included, each with the SHA-256 of its tarball. The digest is pinned for the core packages; for the others the CLI computes it at download and keeps it in the package cache (`<id>#<version>/cindermed.json`), downloading the tarball again for a package cached without it. An unknown digest blocks the export with `EXPORT_PACKAGE_DIGEST_MISSING`. The definition index (format 1.2.0) carries the digest of each package as `tarballSha256`. 1.0.0 manifests still validate.
- 3d4a3f1: A `dateTime` column whose values have a time now needs a time zone, its own or its table's: validation reports `TIME_ZONE_MISSING` (error) otherwise. `columnTimeZone` and `takesTimeZone` move to `@cindermed/model` (`@cindermed/fml` no longer exports `columnTimeZone`). The mapping table's Columns sheet shows the time zone of a date-time column in its Format cell.

### Patch Changes

- 5b5460c: Each package now has the metadata a publish needs: `repository`, `homepage`, `bugs`, `engines` (Node 22.12 or later), a README and the LICENSE. Its tarball holds only `dist/` without source maps, its LICENSE and its README. Nothing is published: npm publishing is deferred after the MVP (#199), and every package stays private.
- Updated dependencies [cd92662]
- Updated dependencies [6b56067]
- Updated dependencies [29d3164]
- Updated dependencies [0abf6a6]
- Updated dependencies [cd92662]
- Updated dependencies [dba1cdd]
- Updated dependencies [e625743]
- Updated dependencies [5b5460c]
- Updated dependencies [0e83ca7]
- Updated dependencies [3d4a3f1]
  - @cindermed/fhir-defs@0.2.0
  - @cindermed/model@0.6.0
  - @cindermed/fml@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [84850af]
- Updated dependencies [232b1ec]
  - @cindermed/model@0.5.0
  - @cindermed/fhir-defs@0.1.1
  - @cindermed/fml@0.2.1

## 0.2.0

### Minor Changes

- f142b7f: Type compatibility (D7, ADR-0015): `cindermed validate` checks that each row's transform produces a value of the element's type, in R4 and R5 — `TYPE_MISMATCH`, `TYPE_NEEDS_TRANSFORM` (naming the transform), `COMPLEX_TARGET` (listing the elements that fit; a boolean on `Patient.name` is one), `TYPE_PRECISION` (warning), `EXPRESSION_NOT_TYPE_CHECKED` (warning) — and that fixed values, discriminators and value actions fit their elements. `cindermed export` runs the FHIR checks too, and their errors block the export (`--offline`, `--fhir-cache`, `--no-fhir`). `exportPackage` takes optional `definitions`.

### Patch Changes

- 7f23a9a: Coding from a code column (project format 1.4.0, #106, ADR-0019): a new transform `{ kind: "coding", system, as: "Coding" | "CodeableConcept", displayColumnId? }` writes the column's value as the code of a fixed system, with the display from another column when it has a value, as one FML rule with a typed `create` (so choice elements work). Type checks (string, categorical or integer column; `as` must be the element's type), binding checks on the column's allowed values, integrity checks on the display column, and the mapping table describe it.
- 33c11dd: Cells the generator and the HL7 engine cannot write yet are reported instead of exported (#156, ADR-0015 addendum): on a choice element, a value of another type than the chosen one (casts to string, a date into `…DateTime`, a dateTime constant); a quantity into Age, Duration, Distance or Count; a Quantity constant; a reference into a choice element (`TYPE_MISMATCH`). The export also blocks paths whose choice names the generator would write wrongly (`PATH_UNSUPPORTED`).
- Updated dependencies [7f23a9a]
- Updated dependencies [40357b2]
- Updated dependencies [3ddd95c]
- Updated dependencies [db6c645]
- Updated dependencies [f142b7f]
- Updated dependencies [568b998]
- Updated dependencies [fb72156]
- Updated dependencies [66425f3]
- Updated dependencies [e7b00e9]
- Updated dependencies [87fe1bd]
- Updated dependencies [911e043]
- Updated dependencies [33c11dd]
  - @cindermed/model@0.4.0
  - @cindermed/fml@0.2.0
  - @cindermed/fhir-defs@0.1.0

## 0.1.0

### Minor Changes

- 833addf: `exportPackage` writes the export package (G7): cleaned project copy, maps with StructureMap JSON, logical models, normalization specifications, ConceptMaps, the three schemas and a manifest with SHA-256 digests and load order, in a deterministic zip. Every map passes the grammar check first (G10). The logical models and ConceptMaps take the package version (`logicalModel(…, { version })`, `ConceptMapOptions.version`).
- 5ce287c: `mappingTables`, `toCsv` and `toXlsx` write the mapping table (H1): Mapping, Value maps (every map, boolean ones included, with actions and code verification), Roles and Columns, as CSV (BOM, CRLF, configurable delimiter, formula-injection escape) or as a deterministic XLSX workbook. `@cindermed/fml` exports `conditionText` and `roleCondition`.

### Patch Changes

- 9b2ed46: The mapping table is written for projects with dangling references: an unknown column, role, value map or table reads "unknown column <id>" (and so on) instead of failing.
- Updated dependencies [fb6d6a8]
- Updated dependencies [5724d33]
- Updated dependencies [4dc32cb]
- Updated dependencies [ca3595c]
- Updated dependencies [833addf]
- Updated dependencies [dc587d9]
- Updated dependencies [fbf1095]
- Updated dependencies [0a0c344]
- Updated dependencies [fb6d6a8]
- Updated dependencies [63a3554]
- Updated dependencies [d599612]
- Updated dependencies [f76c3f6]
- Updated dependencies [ce4cfbd]
- Updated dependencies [5ce287c]
- Updated dependencies [30c8d78]
- Updated dependencies [2940d8e]
- Updated dependencies [7111d06]
- Updated dependencies [4d77491]
- Updated dependencies [391d212]
- Updated dependencies [5724d33]
  - @cindermed/model@0.3.0
  - @cindermed/fml@0.1.0
