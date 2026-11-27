# Architecture decision records

Each technical decision that the [specification](../specification.md) does not cover is recorded here as a short ADR: context, decision, consequences. Copy [`0000-template.md`](0000-template.md) to `NNNN-title-in-kebab-case.md` with the next number, and add it to the table in the same pull request.

An accepted ADR is not rewritten: a later decision adds an addendum to it or supersedes it with a new ADR.

| ADR                                                          | Title                                                               | Status   |
| ------------------------------------------------------------ | ------------------------------------------------------------------- | -------- |
| [0001](0001-monorepo-with-extractable-core.md)               | One monorepo, with an extractable domain core                       | accepted |
| [0002](0002-english-project-language.md)                     | English as the project language                                     | accepted |
| [0003](0003-module-0-tooling.md)                             | Module 0 tooling                                                    | accepted |
| [0004](0004-model-types-generated-from-schemas.md)           | Model types generated from the JSON Schemas                         | accepted |
| [0005](0005-integrity-rules-scope.md)                        | Scope and interpretation of the integrity rules                     | accepted |
| [0006](0006-project-file-handling.md)                        | Reading, writing and versioning the project file                    | accepted |
| [0007](0007-structuremap-json-built-from-the-syntax-tree.md) | StructureMap JSON built from the syntax tree                        | accepted |
| [0008](0008-fml-grammar-parser-generated-with-antlr-ng.md)   | FML grammar parser generated with antlr-ng                          | accepted |
| [0009](0009-table-plan-element-names-and-id-fields.md)       | Table plan, element names and id fields                             | accepted |
| [0010](0010-reference-normalizer.md)                         | Reference normalizer                                                | accepted |
| [0011](0011-generator-map-structure.md)                      | Generator map structure                                             | accepted |
| [0012](0012-export-package.md)                               | Export package                                                      | accepted |
| [0013](0013-fhir-definition-index.md)                        | FHIR definition index                                               | accepted |
| [0014](0014-element-paths-and-trees.md)                      | Element paths and trees                                             | accepted |
| [0015](0015-type-compatibility.md)                           | Type compatibility checks                                           | accepted |
| [0016](0016-binding-checks.md)                               | Binding checks                                                      | accepted |
| [0017](0017-reference-checks.md)                             | Reference checks                                                    | accepted |
| [0018](0018-cardinality-first-version.md)                    | Cardinality, first version                                          | accepted |
| [0019](0019-coding-from-a-code-column.md)                    | Coding from a code column                                           | accepted |
| [0020](0020-profile-slice-names.md)                          | Profile slice names in element paths                                | accepted |
| [0021](0021-grid-data-layer.md)                              | Grid data layer and local mode                                      | accepted |
| [0022](0022-cindermed-init.md)                               | `cindermed init`                                                    | accepted |
| [0023](0023-choice-elements-from-definitions.md)             | Element names and choice types from the FHIR definitions            | accepted |
| [0024](0024-time-zones-at-the-border.md)                     | Time zones declared at the border, with a committed tzdata snapshot | accepted |
