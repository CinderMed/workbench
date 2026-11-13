---
"@cindermed/fhir-defs": minor
---

`resolvePath`, `elementTree` and `referenceTargets` answer on the definition index (ADR-0014): project paths with choices by concrete name, named slices (the profile's when it defines one), `contentReference` and datatypes, the cardinality of every segment, and stable error codes (`PATH_NOT_FOUND`, `CHOICE_TYPE_REQUIRED`, `SLICE_NOT_REPEATING`, `EXTENSION_NOT_SUPPORTED`, `PATH_PROHIBITED`, …). `withDefinitions` loads the documents a question needs on demand.
