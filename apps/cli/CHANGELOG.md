# @cindermed/cli

## 0.3.0

### Minor Changes

- 40357b2: Binding checks (D7, ADR-0016): every code a project writes to a bound code, Coding or CodeableConcept element (value-map targets, constants, fixed values, value actions, the allowed values of a copied categorical column) must be in the ValueSet, expanded offline from the FHIR packages — `BINDING_VIOLATION`, an error for required bindings and a warning for extensible and preferred ones; a required ValueSet that cannot be expanded gives a "binding not checked" warning. The definition index (format 1.1.0) carries the expansions of bound ValueSets, and the package loader reads ValueSets and CodeSystems.
- 3ddd95c: Cardinality, first version (D7, ADR-0018): `CARDINALITY_MISMATCH` (error) when a multiple-choice column is written through a value map without `repeat: eachValue`; `DUPLICATE_TARGET` (warning) when two writes reach the same single-valued element of a role and their conditions are not recognised as exclusive (the same column needed with different values, or with a value against none).
- db6c645: `cindermed validate` checks the project against the FHIR definitions of its version (D7, paths): every role's resource type and profile, and every path the project writes (mapping rows, fixed values, value-map actions, declared slices and their discriminators) — `PATH_NOT_FOUND`, `CHOICE_TYPE_REQUIRED`, `SLICE_NOT_REPEATING`, `EXTENSION_NOT_SUPPORTED`, `PATH_PROHIBITED`, `REPEAT_TARGET_NOT_REPEATING`, `RESOURCE_TYPE_UNKNOWN`, `PROFILE_UNKNOWN`, `PROFILE_TYPE_MISMATCH`. The FHIR packages come from the shared cache `~/.fhir/packages` and are downloaded once when missing; new options `--offline`, `--fhir-cache <folder>` and `--no-fhir`. `@cindermed/fhir-defs` exports `validateFhir` and `loadProjectDefinitions`; `@cindermed/model` exports `rowValueMaps`.
- f142b7f: Type compatibility (D7, ADR-0015): `cindermed validate` checks that each row's transform produces a value of the element's type, in R4 and R5 — `TYPE_MISMATCH`, `TYPE_NEEDS_TRANSFORM` (naming the transform), `COMPLEX_TARGET` (listing the elements that fit; a boolean on `Patient.name` is one), `TYPE_PRECISION` (warning), `EXPRESSION_NOT_TYPE_CHECKED` (warning) — and that fixed values, discriminators and value actions fit their elements. `cindermed export` runs the FHIR checks too, and their errors block the export (`--offline`, `--fhir-cache`, `--no-fhir`). `exportPackage` takes optional `definitions`.
- fb72156: Reference checks (F4, ADR-0017): `REF_TARGET_NOT_ALLOWED` (error) when a reference points to a role whose type the element's target profiles do not allow (a warning, "target not checked", when those profiles are not in the definitions); `REFERENCE_REQUIRED_MISSING` (warning) when a required top-level Reference of a role is not written; `ROLE_ORPHAN` (warning) when, with two or more roles, a role is linked to no other role.
- 87fe1bd: Profile slice names in element paths (#150, ADR-0020): slice names in `ElementPath` and `Slice.name` may start with an upper-case letter (`[A-Za-z][A-Za-z0-9-]*`, project format 1.4.0), so profile slices such as `category[VSCat]` can be written. `SLICE_NAME_UNUSABLE` (warning) reports a required profile slice whose name a project path cannot hold.

### Patch Changes

- 66425f3: `@cindermed/fhir-defs` builds and reads the compact FHIR definition index (ADR-0013): a manifest of the types and profiles of a FHIR version and its packages, and one small document per type, loaded on demand and checked against its SHA-256. The CLI gains the FHIR package loader (shared `~/.fhir/packages` cache, download from packages.fhir.org with pinned SHA-256 for the core packages, offline mode); no command uses it yet.
- deb01c4: The FHIR package loader refuses tarballs with entries other than files and folders (symbolic and hard links, devices, FIFOs) or with paths outside their folder, limits downloads to 100 MB and extracted packages to 500 MB, and gives up on a registry request after 120 s, each with a clear error and nothing left in the cache.
- Updated dependencies [7f23a9a]
- Updated dependencies [40357b2]
- Updated dependencies [3ddd95c]
- Updated dependencies [db6c645]
- Updated dependencies [f142b7f]
- Updated dependencies [fb72156]
- Updated dependencies [66425f3]
- Updated dependencies [e7b00e9]
- Updated dependencies [87fe1bd]
- Updated dependencies [911e043]
- Updated dependencies [33c11dd]
  - @cindermed/model@0.4.0
  - @cindermed/fhir-defs@0.1.0
  - @cindermed/export@0.2.0

## 0.2.0

### Minor Changes

- bbbf421: `cindermed export <project.json>` writes the export package as a deterministic zip or into a folder, with `--out`, `--package-version`, `--created-at` and `--format text|json`; a project with errors is not exported (exit code 1).
- 9b2ed46: `cindermed mapping-table <project.json>` writes the mapping table (H1) as one XLSX workbook (default) or as one CSV file per sheet in a folder, with `--format xlsx|csv`, `--delimiter`, `--out` and `--created-at`. Options that do not apply to a command are rejected.

### Patch Changes

- Updated dependencies [fb6d6a8]
- Updated dependencies [5724d33]
- Updated dependencies [833addf]
- Updated dependencies [9b2ed46]
- Updated dependencies [5ce287c]
- Updated dependencies [2940d8e]
- Updated dependencies [7111d06]
- Updated dependencies [4d77491]
- Updated dependencies [391d212]
- Updated dependencies [5724d33]
  - @cindermed/model@0.3.0
  - @cindermed/export@0.1.0

## 0.1.0

### Minor Changes

- 0f9df12: Add the `cindermed validate <project.json> [--format text|json]` command, with exit codes 0 (valid), 1 (errors) and 2 (could not run).

### Patch Changes

- Updated dependencies [9621442]
- Updated dependencies [baa2634]
- Updated dependencies [0f9df12]
- Updated dependencies [242c717]
  - @cindermed/model@0.2.0
