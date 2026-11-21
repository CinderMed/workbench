---
"@cindermed/fml": minor
"@cindermed/export": minor
"@cindermed/cli": minor
---

The generator takes element names and choice types from the FHIR definitions instead of a fixed list of names (#156, ADR-0023). `generateMap(project, plan, written)` gets them as plain data, which `@cindermed/export` resolves with `@cindermed/fhir-defs` for every path the generator writes (`pathsToWrite`). On a choice element, a value whose type is not the chosen one is written with that type (`res.value = create('string') as x, x.value = v`), and a type derived from Quantity, or a path through a choice, is opened with its type (`create('Age')`, `create('Quantity') as p`). No existing map changes. `exportPackage` now requires `definitions`, and `cindermed export` always loads them: `--no-fhir` applies to `validate` only, and the export stops with the reason when the FHIR packages cannot be loaded. The cells of #156 stay turned off until their golden cases.
