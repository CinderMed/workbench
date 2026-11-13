# @cindermed/fhir-defs

## 0.1.0

### Minor Changes

- db6c645: `cindermed validate` checks the project against the FHIR definitions of its version (D7, paths): every role's resource type and profile, and every path the project writes (mapping rows, fixed values, value-map actions, declared slices and their discriminators) — `PATH_NOT_FOUND`, `CHOICE_TYPE_REQUIRED`, `SLICE_NOT_REPEATING`, `EXTENSION_NOT_SUPPORTED`, `PATH_PROHIBITED`, `REPEAT_TARGET_NOT_REPEATING`, `RESOURCE_TYPE_UNKNOWN`, `PROFILE_UNKNOWN`, `PROFILE_TYPE_MISMATCH`. The FHIR packages come from the shared cache `~/.fhir/packages` and are downloaded once when missing; new options `--offline`, `--fhir-cache <folder>` and `--no-fhir`. `@cindermed/fhir-defs` exports `validateFhir` and `loadProjectDefinitions`; `@cindermed/model` exports `rowValueMaps`.
- 66425f3: `@cindermed/fhir-defs` builds and reads the compact FHIR definition index (ADR-0013): a manifest of the types and profiles of a FHIR version and its packages, and one small document per type, loaded on demand and checked against its SHA-256. The CLI gains the FHIR package loader (shared `~/.fhir/packages` cache, download from packages.fhir.org with pinned SHA-256 for the core packages, offline mode); no command uses it yet.
- e7b00e9: `resolvePath`, `elementTree` and `referenceTargets` answer on the definition index (ADR-0014): project paths with choices by concrete name, named slices (the profile's when it defines one), `contentReference` and datatypes, the cardinality of every segment, and stable error codes (`PATH_NOT_FOUND`, `CHOICE_TYPE_REQUIRED`, `SLICE_NOT_REPEATING`, `EXTENSION_NOT_SUPPORTED`, `PATH_PROHIBITED`, …). `withDefinitions` loads the documents a question needs on demand.

### Patch Changes

- Updated dependencies [db6c645]
  - @cindermed/model@0.4.0
