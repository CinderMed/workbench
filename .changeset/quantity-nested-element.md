---
"@cindermed/fml": minor
---

A quantity can be written on a two-level path by a single row (#125): `src.col as v -> res.referenceRange as p, p.low = create('Quantity') as q then { … }`, the parent opened inline as for other single rows, and a choice at the second level created with its chosen type (`component.valueQuantity`). Before, such a row was `PATH_UNSUPPORTED`; rows sharing the parent (`referenceRange.low` and `.high`) already worked.
