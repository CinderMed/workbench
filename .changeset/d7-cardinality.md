---
"@cindermed/fhir-defs": minor
"@cindermed/cli": minor
---

Cardinality, first version (D7, ADR-0018): `CARDINALITY_MISMATCH` (error) when a multiple-choice column is written through a value map without `repeat: eachValue`; `DUPLICATE_TARGET` (warning) when two writes reach the same single-valued element of a role and their conditions are not recognised as exclusive (the same column needed with different values, or with a value against none).
