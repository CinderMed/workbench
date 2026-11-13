# @cindermed/fml

## 0.1.1

### Patch Changes

- 568b998: Element names now start with a letter followed, if there is more, by a letter or a digit: the prefix `c` is added as many times as needed (`a b` → `ca_b`, `😀 mood` → `cc__mood`, `a` stays `a`). The HL7 FHIRPath parser rejects names whose second character is `_`, so maps with such a column in a creation condition did not compile (#134). Names that compiled before do not change.
- Updated dependencies [db6c645]
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
