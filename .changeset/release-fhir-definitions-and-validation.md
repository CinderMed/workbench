---
"@cindermed/api": minor
"@cindermed/web": minor
---

Module 3 (FHIR definitions and validation): the compact FHIR definition index and package loader (`@cindermed/fhir-defs`), and `cindermed validate` and `cindermed export` checking a project against the FHIR definitions of its version, R4 or R5 (D7: paths, type compatibility, bindings, cardinality in a first version; F4: references). FHIR errors block the export. Project format 1.4.0 adds a Coding or CodeableConcept from a code column (`coding` transform) and profile slice names that start with an upper-case letter (`category[VSCat]`). The API and web app do not use them yet.

Known limitations:

- #156: the generator writes choice elements by their base name, so the HL7 engine takes the type of the value. Until this is fixed, the combinations it cannot run are reported as `TYPE_MISMATCH`: on a choice element, a value whose type is not the chosen one; a quantity into Age, Duration, Distance or Count.
- Cardinality, first version: `DUPLICATE_TARGET` is a warning, and only conditions on the same column (different values, or a value against none) are recognised as exclusive.
- #146: the export manifest does not yet record the SHA-256 of each FHIR package a project uses (planned before npm publishing, module 3b).
