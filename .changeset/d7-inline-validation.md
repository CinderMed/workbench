---
"@cindermed/web": minor
---

Inline validation in the local mode (D7, #16): after every change the project is checked in a Web Worker with the same rules as `cindermed validate` (schema, integrity, quality, and the FHIR checks with the definitions from `cindermed fhir-index`); the grid colours error cells red and warning cells yellow with the reasons, a summary shows the counts and whether the FHIR checks ran, and results of an older run are dropped.
