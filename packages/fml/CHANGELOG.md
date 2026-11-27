# @cindermed/fml

## 0.3.0

### Minor Changes

- 6b56067: A quantity can take its unit text from a column (project format 1.5.0, #108): `unitColumnId` without `unitValueMapId` writes `src.uom as u -> q.unit = u`, one rule for any number of units, such as MIMIC-IV's `valueuom`. The new optional `unitSystem` also writes the text as the code of that system (`q.system = '<system>', q.code = u`); the schema accepts it only with `unitColumnId` and without `unitValueMapId`. Before, a unit column without a value map wrote no unit. The mapping table names the unit text and its system, and the grid's quantity editor offers "Unit text from a column" with the optional code system.
- 29d3164: Time zones at the border (#107, ADR-0024). Project format 1.5.0 adds an optional `timeZone` on a table and on a column: a fixed offset (`+01:00`, `Z`) or an IANA zone (`Europe/Rome`). Normalization 1.3.0 writes a dateTime with a time with its offset (`2025-01-15T10:00:00+01:00`). An IANA zone's offsets come from the zone's rules in the specification's new `timeZones`, which the export copies from a committed tzdata snapshot (2026e, 1970–2299), so every implementation gives the same result without a time-zone library. A local time in the spring-forward gap is an invalid value; one in the repeated fall-back hour takes the earlier offset. Integrity rule 10 reports a zone the snapshot does not have (`TIME_ZONE_UNKNOWN`, error) and a zone on a column that is not dateTime (`TIME_ZONE_NOT_DATETIME`, warning). Projects without a zone convert as before.
- 0abf6a6: The generator writes the concatenation transform (D5, #98): `src where ($this.a.exists() or $this.b.exists()) -> res.element = evaluate(src, $this.a.toString().combine($this.b.toString()).join(' '))`. The columns are joined in the row's order with the separator (a space by default), empty columns are skipped, a decimal keeps its digits (`1.50`), and an all-empty row writes no element. A separator with `'` or a control character is written in base64 and decoded by FHIRPath, because the HL7 engine loses the escape of a quote. `cindermed export` no longer refuses concatenations (`TRANSFORM_UNSUPPORTED` stays for expert expressions). The grid's transform editor offers concatenation again.
- cd92662: The generator takes element names and choice types from the FHIR definitions instead of a fixed list of names (#156, ADR-0023). `generateMap(project, plan, written)` gets them as plain data, which `@cindermed/export` resolves with `@cindermed/fhir-defs` for every path the generator writes (`pathsToWrite`). On a choice element, a value whose type is not the chosen one is written with that type (`res.value = create('string') as x, x.value = v`), and a type derived from Quantity, or a path through a choice, is opened with its type (`create('Age')`, `create('Quantity') as p`). No existing map changes. `exportPackage` now requires `definitions`, and `cindermed export` always loads them: `--no-fhir` applies to `validate` only, and the export stops with the reason when the FHIR packages cannot be loaded. The cells of #156 stay turned off until their golden cases.
- 0e83ca7: A quantity can be written on a two-level path by a single row (#125): `src.col as v -> res.referenceRange as p, p.low = create('Quantity') as q then { … }`, the parent opened inline as for other single rows, and a choice at the second level created with its chosen type (`component.valueQuantity`). Before, such a row was `PATH_UNSUPPORTED`; rows sharing the parent (`referenceRange.low` and `.high`) already worked.
- 3d4a3f1: A `dateTime` column whose values have a time now needs a time zone, its own or its table's: validation reports `TIME_ZONE_MISSING` (error) otherwise. `columnTimeZone` and `takesTimeZone` move to `@cindermed/model` (`@cindermed/fml` no longer exports `columnTimeZone`). The mapping table's Columns sheet shows the time zone of a date-time column in its Format cell.

### Patch Changes

- dba1cdd: The R5 StructureMap form (ADR-0007) is now checked by the HL7 engine on an R5 golden case (#78). The engine runs it, and the Bundle validates in R5 with 0 errors. The generator is unchanged.
- 5b5460c: Each package now has the metadata a publish needs: `repository`, `homepage`, `bugs`, `engines` (Node 22.12 or later), a README and the LICENSE. Its tarball holds only `dist/` without source maps, its LICENSE and its README. Nothing is published: npm publishing is deferred after the MVP (#199), and every package stays private.
- Updated dependencies [6b56067]
- Updated dependencies [29d3164]
- Updated dependencies [e625743]
- Updated dependencies [5b5460c]
- Updated dependencies [3d4a3f1]
  - @cindermed/model@0.6.0

## 0.2.1

### Patch Changes

- Updated dependencies [84850af]
- Updated dependencies [232b1ec]
  - @cindermed/model@0.5.0

## 0.2.0

### Minor Changes

- 7f23a9a: Coding from a code column (project format 1.4.0, #106, ADR-0019): a new transform `{ kind: "coding", system, as: "Coding" | "CodeableConcept", displayColumnId? }` writes the column's value as the code of a fixed system, with the display from another column when it has a value, as one FML rule with a typed `create` (so choice elements work). Type checks (string, categorical or integer column; `as` must be the element's type), binding checks on the column's allowed values, integrity checks on the display column, and the mapping table describe it.

### Patch Changes

- 568b998: Element names now start with a letter followed, if there is more, by a letter or a digit: the prefix `c` is added as many times as needed (`a b` → `ca_b`, `😀 mood` → `cc__mood`, `a` stays `a`). The HL7 FHIRPath parser rejects names whose second character is `_`, so maps with such a column in a creation condition did not compile (#134). Names that compiled before do not change.
- Updated dependencies [7f23a9a]
- Updated dependencies [db6c645]
- Updated dependencies [87fe1bd]
- Updated dependencies [911e043]
  - @cindermed/model@0.4.0

## 0.1.0

### Minor Changes

- 4dc32cb: ConceptMaps list the value-map entries with `skipInstance`, `absent` or `setElement` as deliberately unmapped: R4 `equivalence: unmatched` with a comment naming the action, R5 `noMap: true`.
- ca3595c: `conceptMap` and `conceptMaps` generate one ConceptMap per value map (R4 or R5 form), as documentation: `use` entries grouped by target system and version, no `description` when the value map has none, and no ConceptMap for boolean value maps.
- 833addf: `exportPackage` writes the export package (G7): cleaned project copy, maps with StructureMap JSON, logical models, normalization specifications, ConceptMaps, the three schemas and a manifest with SHA-256 digests and load order, in a deterministic zip. Every map passes the grammar check first (G10). The logical models and ConceptMaps take the package version (`logicalModel(…, { version })`, `ConceptMapOptions.version`).
- dc587d9: Check FML text against the official grammar mapping.g4 (commit 8bb04b4) and trace grammar errors back to the rule and mapping row that produced them.
- fbf1095: Add the FML syntax tree, the deterministic printer with a line-to-rule index, and the StructureMap JSON built from the tree.
- 0a0c344: Generate the logical model of the normalized row and the normalization specification of each table, with element names and id fields planned once per table.
- fb6d6a8: Add `valueRuleNames`: the names of the rules generated for a value map, `<row code>-<value>` with a numeric suffix on collisions.
- d599612: `generateMap(project, plan)` builds the FML syntax tree of a table: map skeleton, one entry per role with its id and creation condition (including `skipInstance` values), role groups with fixed values, copies, shared blocks, named slices and references (guarded when the target role is conditional). Unsupported features are generator errors (`TRANSFORM_UNSUPPORTED`, `CONDITION_EXPRESSION_UNSUPPORTED`, `MULTIPLICITY_PER_VALUE_UNSUPPORTED`, `PATH_UNSUPPORTED`, `FIXED_VALUE_UNSUPPORTED`).
- f76c3f6: Generated resources are valid FHIR: maps declare the created resource types with `uses … as target`, value-map rule names are FHIR ids (`-` instead of `_`, at most 64 characters, suffix after the cut), and the logical model's root element has a definition (table description, or "Normalized row of table <name>"). `ruleName` accepts only FHIR ids.
- ce4cfbd: `generateMap` writes value maps (one rule per value; `use` with `also`, `setElement`, `skipInstance` in the role condition, `absent`), quantities with a fixed unit or a unit value map, and the `repeat eachValue` comment. Rule names are checked within each group (`DUPLICATE_RULE_NAME`), and a `use` entry without a target is `VALUE_MAP_ENTRY_WITHOUT_TARGET`.
- 5ce287c: `mappingTables`, `toCsv` and `toXlsx` write the mapping table (H1): Mapping, Value maps (every map, boolean ones included, with actions and code verification), Roles and Columns, as CSV (BOM, CRLF, configurable delimiter, formula-injection escape) or as a deterministic XLSX workbook. `@cindermed/fml` exports `conditionText` and `roleCondition`.
- 2940d8e: Normalization format 1.2.0: the generator writes the allowed values of categorical and multiple-choice columns into the normalization specification, and a value outside the list is an invalid value (`onInvalidValue` applies). Rule 6 reports a categorical or multiple-choice column used by a value map without allowed values (`VALUE_MAP_COLUMN_WITHOUT_ALLOWED_VALUES`), and the new quality level warns about such columns without a value map (`ALLOWED_VALUES_MISSING`).
- 4d77491: Project format 1.3.0 adds a column's `decimalSeparator` and `project.output.onInvalidValue` (default `fail`); normalization format 1.1.0 adds `onInvalidValue: fail`. The generator writes both into every normalization specification.

### Patch Changes

- 5724d33: Rule 9 reports a categorical or multiple-choice column whose allowed values are empty once missing values are removed (`ALLOWED_VALUES_EMPTY`); the normalization schema requires at least one allowed value, and the generator refuses to write an empty list.
- 63a3554: Internal: the generator's working state no longer uses TypeScript parameter properties, so the sources type-check under `erasableSyntaxOnly` (used by the tooling tests that import them). No change in behaviour or output.
- 30c8d78: The StructureMap narrative writes code points above U+FFFF (emoji, for example) as numeric references such as `&#x1F600;`, as the HL7 engine does, so the JSON matches the engine's output. Accented letters stay as they are.
- Updated dependencies [fb6d6a8]
- Updated dependencies [5724d33]
- Updated dependencies [2940d8e]
- Updated dependencies [7111d06]
- Updated dependencies [4d77491]
- Updated dependencies [391d212]
- Updated dependencies [5724d33]
  - @cindermed/model@0.3.0
