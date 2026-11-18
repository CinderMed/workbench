---
"@cindermed/fhir-defs": minor
"@cindermed/export": minor
"@cindermed/cli": minor
---

Type compatibility (D7, ADR-0015): `cindermed validate` checks that each row's transform produces a value of the element's type, in R4 and R5 — `TYPE_MISMATCH`, `TYPE_NEEDS_TRANSFORM` (naming the transform), `COMPLEX_TARGET` (listing the elements that fit; a boolean on `Patient.name` is one), `TYPE_PRECISION` (warning), `EXPRESSION_NOT_TYPE_CHECKED` (warning) — and that fixed values, discriminators and value actions fit their elements. `cindermed export` runs the FHIR checks too, and their errors block the export (`--offline`, `--fhir-cache`, `--no-fhir`). `exportPackage` takes optional `definitions`.
