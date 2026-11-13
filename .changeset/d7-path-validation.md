---
"@cindermed/fhir-defs": minor
"@cindermed/model": minor
"@cindermed/cli": minor
---

`cindermed validate` checks the project against the FHIR definitions of its version (D7, paths): every role's resource type and profile, and every path the project writes (mapping rows, fixed values, value-map actions, declared slices and their discriminators) — `PATH_NOT_FOUND`, `CHOICE_TYPE_REQUIRED`, `SLICE_NOT_REPEATING`, `EXTENSION_NOT_SUPPORTED`, `PATH_PROHIBITED`, `REPEAT_TARGET_NOT_REPEATING`, `RESOURCE_TYPE_UNKNOWN`, `PROFILE_UNKNOWN`, `PROFILE_TYPE_MISMATCH`. The FHIR packages come from the shared cache `~/.fhir/packages` and are downloaded once when missing; new options `--offline`, `--fhir-cache <folder>` and `--no-fhir`. `@cindermed/fhir-defs` exports `validateFhir` and `loadProjectDefinitions`; `@cindermed/model` exports `rowValueMaps`.
