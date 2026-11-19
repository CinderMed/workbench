---
"@cindermed/fhir-defs": patch
"@cindermed/export": patch
---

Cells the generator and the HL7 engine cannot write yet are reported instead of exported (#156, ADR-0015 addendum): on a choice element, a value of another type than the chosen one (casts to string, a date into `…DateTime`, a dateTime constant); a quantity into Age, Duration, Distance or Count; a Quantity constant; a reference into a choice element (`TYPE_MISMATCH`). The export also blocks paths whose choice names the generator would write wrongly (`PATH_UNSUPPORTED`).
