# @cindermed/fhir-defs

## 0.1.1

### Patch Changes

- Updated dependencies [84850af]
- Updated dependencies [232b1ec]
  - @cindermed/model@0.5.0

## 0.1.0

### Minor Changes

- 7f23a9a: Coding from a code column (project format 1.4.0, #106, ADR-0019): a new transform `{ kind: "coding", system, as: "Coding" | "CodeableConcept", displayColumnId? }` writes the column's value as the code of a fixed system, with the display from another column when it has a value, as one FML rule with a typed `create` (so choice elements work). Type checks (string, categorical or integer column; `as` must be the element's type), binding checks on the column's allowed values, integrity checks on the display column, and the mapping table describe it.
- 40357b2: Binding checks (D7, ADR-0016): every code a project writes to a bound code, Coding or CodeableConcept element (value-map targets, constants, fixed values, value actions, the allowed values of a copied categorical column) must be in the ValueSet, expanded offline from the FHIR packages — `BINDING_VIOLATION`, an error for required bindings and a warning for extensible and preferred ones; a required ValueSet that cannot be expanded gives a "binding not checked" warning. The definition index (format 1.1.0) carries the expansions of bound ValueSets, and the package loader reads ValueSets and CodeSystems.
- 3ddd95c: Cardinality, first version (D7, ADR-0018): `CARDINALITY_MISMATCH` (error) when a multiple-choice column is written through a value map without `repeat: eachValue`; `DUPLICATE_TARGET` (warning) when two writes reach the same single-valued element of a role and their conditions are not recognised as exclusive (the same column needed with different values, or with a value against none).
- db6c645: `cindermed validate` checks the project against the FHIR definitions of its version (D7, paths): every role's resource type and profile, and every path the project writes (mapping rows, fixed values, value-map actions, declared slices and their discriminators) — `PATH_NOT_FOUND`, `CHOICE_TYPE_REQUIRED`, `SLICE_NOT_REPEATING`, `EXTENSION_NOT_SUPPORTED`, `PATH_PROHIBITED`, `REPEAT_TARGET_NOT_REPEATING`, `RESOURCE_TYPE_UNKNOWN`, `PROFILE_UNKNOWN`, `PROFILE_TYPE_MISMATCH`. The FHIR packages come from the shared cache `~/.fhir/packages` and are downloaded once when missing; new options `--offline`, `--fhir-cache <folder>` and `--no-fhir`. `@cindermed/fhir-defs` exports `validateFhir` and `loadProjectDefinitions`; `@cindermed/model` exports `rowValueMaps`.
- f142b7f: Type compatibility (D7, ADR-0015): `cindermed validate` checks that each row's transform produces a value of the element's type, in R4 and R5 — `TYPE_MISMATCH`, `TYPE_NEEDS_TRANSFORM` (naming the transform), `COMPLEX_TARGET` (listing the elements that fit; a boolean on `Patient.name` is one), `TYPE_PRECISION` (warning), `EXPRESSION_NOT_TYPE_CHECKED` (warning) — and that fixed values, discriminators and value actions fit their elements. `cindermed export` runs the FHIR checks too, and their errors block the export (`--offline`, `--fhir-cache`, `--no-fhir`). `exportPackage` takes optional `definitions`.
- fb72156: Reference checks (F4, ADR-0017): `REF_TARGET_NOT_ALLOWED` (error) when a reference points to a role whose type the element's target profiles do not allow (a warning, "target not checked", when those profiles are not in the definitions); `REFERENCE_REQUIRED_MISSING` (warning) when a required top-level Reference of a role is not written; `ROLE_ORPHAN` (warning) when, with two or more roles, a role is linked to no other role.
- 66425f3: `@cindermed/fhir-defs` builds and reads the compact FHIR definition index (ADR-0013): a manifest of the types and profiles of a FHIR version and its packages, and one small document per type, loaded on demand and checked against its SHA-256. The CLI gains the FHIR package loader (shared `~/.fhir/packages` cache, download from packages.fhir.org with pinned SHA-256 for the core packages, offline mode); no command uses it yet.
- e7b00e9: `resolvePath`, `elementTree` and `referenceTargets` answer on the definition index (ADR-0014): project paths with choices by concrete name, named slices (the profile's when it defines one), `contentReference` and datatypes, the cardinality of every segment, and stable error codes (`PATH_NOT_FOUND`, `CHOICE_TYPE_REQUIRED`, `SLICE_NOT_REPEATING`, `EXTENSION_NOT_SUPPORTED`, `PATH_PROHIBITED`, …). `withDefinitions` loads the documents a question needs on demand.
- 87fe1bd: Profile slice names in element paths (#150, ADR-0020): slice names in `ElementPath` and `Slice.name` may start with an upper-case letter (`[A-Za-z][A-Za-z0-9-]*`, project format 1.4.0), so profile slices such as `category[VSCat]` can be written. `SLICE_NAME_UNUSABLE` (warning) reports a required profile slice whose name a project path cannot hold.

### Patch Changes

- 33c11dd: Cells the generator and the HL7 engine cannot write yet are reported instead of exported (#156, ADR-0015 addendum): on a choice element, a value of another type than the chosen one (casts to string, a date into `…DateTime`, a dateTime constant); a quantity into Age, Duration, Distance or Count; a Quantity constant; a reference into a choice element (`TYPE_MISMATCH`). The export also blocks paths whose choice names the generator would write wrongly (`PATH_UNSUPPORTED`).
- Updated dependencies [7f23a9a]
- Updated dependencies [db6c645]
- Updated dependencies [87fe1bd]
- Updated dependencies [911e043]
  - @cindermed/model@0.4.0
