---
"@cindermed/fhir-defs": minor
"@cindermed/cli": minor
---

Binding checks (D7, ADR-0016): every code a project writes to a bound code, Coding or CodeableConcept element (value-map targets, constants, fixed values, value actions, the allowed values of a copied categorical column) must be in the ValueSet, expanded offline from the FHIR packages — `BINDING_VIOLATION`, an error for required bindings and a warning for extensible and preferred ones; a required ValueSet that cannot be expanded gives a "binding not checked" warning. The definition index (format 1.1.0) carries the expansions of bound ValueSets, and the package loader reads ValueSets and CodeSystems.
