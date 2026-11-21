---
"@cindermed/fhir-defs": minor
"@cindermed/export": minor
---

The #156 cells that now have a golden case are turned back on: copies, casts, constants and fixed values on a choice element (written with the chosen type), a quantity on a choice chosen as Age, a path through a choice and element names such as `doseQuantity`. Still turned off, with no golden case: a value map to `code` on a choice, a reference on a choice, other types derived from Quantity, and Quantity constants.
