# @cindermed/export

## 0.1.1

### Patch Changes

- Updated dependencies [db6c645]
- Updated dependencies [568b998]
  - @cindermed/model@0.4.0
  - @cindermed/fml@0.1.1

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
