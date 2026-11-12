# ADR-0011: Generator map structure: shared blocks, conditions, choice elements and comments

- Status: accepted
- Date: 2026-11-12
- Module: 2 (Generator and package)

## Context

`generateMap` (`packages/fml/src/generator/generate-map.ts`) turns a table of a project into the FML syntax tree. The verified maps (`fixtures/fml-examples`) were written by hand. They follow the translation rules of the specification, but they also make choices the project file cannot explain:

- comments that differ from map to map;
- blank lines;
- a single row on `identifier` written as a shared block, while a single row on `period` is written inline. The only difference is that `identifier` repeats, and cardinality comes from the FHIR definitions in module 3.

The generator must be deterministic and must never need hand edits, and the fixtures must eventually be produced by the generator (#97).

## Decision

- **Shared blocks without cardinality.** Two or more rows writing the same parent element share one block, guarded by the presence of any of their columns (`src where ($this.a.exists() or $this.b.exists()) -> res.period as p then { … }`). That is what keeps a non-repeating element single. A single row writes the parent inline (`res.period as p, p.start = v`). A named slice is always a block, with its discriminator rules first. For one row both forms give the same Bundle: neither creates the element when the cell is empty.
  - Consequence: the single-row `identifier` blocks of MotuPatient, FirstOverview and Visit become inline when #97 regenerates the maps. Until then their golden check in the value-map branch compares behaviour, meaning the Bundles produced by the HL7 engine, instead of text.
- **Creation conditions.** A role entry is guarded by the presence of its id, then `createWhen`, then one `.where(…).empty()` clause per value map of the role's rows with `skipInstance` entries. A clause identical to one already in `createWhen` is not repeated.
  - This reproduces Metastra: Condition[1] gets `… and $this.cond_osteoporosis_yn.where($this = '0').empty()` from its value map, while Observation[0]'s `-1` is already in `createWhen`.
  - A reference to a conditional role of the same table is guarded by that role's condition (`<code>-guard`). A row with its own condition is guarded the same way.
- **`cast` is written as a copy.** The normalization has already converted the value to the column's type. Type checks come in module 3 (D7).
- **Choice elements.** A path through a choice element carries its type (`valueQuantity`, `component[nrs].valueInteger`), but the FML target is the element name (`res.value`). Until the FHIR definitions arrive in module 3, the generator recognises a fixed list of R4 choice element names (`value`, `effective`, `onset`, `abatement`, `deceased`, …) followed by a FHIR data type. A rule based only on type suffixes would wrongly strip `birthDate` and `recordedDate`; a test guards both. Module 3 replaces the list with the definitions.
- **Names, order and comments** follow the specification ("Translation rules", "Rule names, order and comments"). Fixed values come first, then the rows in project order. Comments come only from the listed templates.
- **Generator errors** for features the schema accepts but the generator does not translate:
  - `TRANSFORM_UNSUPPORTED`: the expert expression for the whole MVP; concatenation until #98; value maps and quantities until the value-map branch (#11, #12);
  - `CONDITION_EXPRESSION_UNSUPPORTED`;
  - `MULTIPLICITY_PER_VALUE_UNSUPPORTED`: no golden case yet;
  - `PATH_UNSUPPORTED`: more than two levels, a slice below the first level, or a nested fixed value;
  - `FIXED_VALUE_UNSUPPORTED`: a Quantity, or a CodeableConcept with text.
- **Golden comparison until #97.** The generated HospitalStay and Fall maps are compared with the fixtures. The test ignores only `//` comment lines and blank lines in the FML, and `status` and `text.div` in the StructureMap JSON. Every other byte must match. The relaxed test links #97, which makes it strict.

## Consequences

- The fixture maps change at #97 (comments, blank lines, single-row `identifier` blocks, and the Metastra rule names `subject-auto`/`encounter-auto`, which become `R-015`/`R-016`). The Bundles must not change. From then on the maps are only produced by the generator.
- Element paths deeper than two levels, `perValue` roles and expert expressions need new golden cases before they are supported.
- The choice-element list is a stopgap until module 3; an unknown choice element is written as it is and fails at compilation (verification level 3), not silently.
