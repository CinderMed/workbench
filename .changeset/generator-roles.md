---
"@cindermed/fml": minor
---

`generateMap(project, plan)` builds the FML syntax tree of a table: map skeleton, one entry per role with its id and creation condition (including `skipInstance` values), role groups with fixed values, copies, shared blocks, named slices and references (guarded when the target role is conditional). Unsupported features are generator errors (`TRANSFORM_UNSUPPORTED`, `CONDITION_EXPRESSION_UNSUPPORTED`, `MULTIPLICITY_PER_VALUE_UNSUPPORTED`, `PATH_UNSUPPORTED`, `FIXED_VALUE_UNSUPPORTED`).
