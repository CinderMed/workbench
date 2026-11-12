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

## Addendum (2026-11-12): value maps, quantities and rule names

- **Value maps.** One rule per entry, `src.col as v where ($this = 'value') -> <target>`, named with `valueRuleNames` over every entry of the map, so a name does not change when an action changes.
  - `use` writes the target (a constant, `c(…)` or `cc(…)`) plus its `also` elements.
  - `setElement` writes only its elements.
  - `skipInstance` and `absent` get no rule; `skipInstance` joins the role's condition.
  - The first rule carries the value-map comment, preceded by the `repeat eachValue` comment when the row has one.
- **Quantities.** `create('Quantity') as q`, then `v -> q.value = v "<code>-value"` and the unit rules: a fixed unit (`<code>-unit`) or one rule per value of the unit column's `Quantity.unit` map (`<code>-unit-<value>`). The unit text is the Coding display, or its code when there is no display.
- **Rule names (#90).** The generator checks that the rules of each group, nested rules included, have different names (`DUPLICATE_RULE_NAME`). The check is per group, not per map: the verified Metastra map has `fixed-status` in four groups, and the line index and diagnostics identify a rule by group and name.
- **Behaviour check of the generated maps.** `tooling/golden/run-examples.sh` has a second pass. It replaces every map of a copy of the fixtures with the generated FML and StructureMap JSON (`tooling/golden/generate-maps.mjs`) and runs the same suite. All 13 checks must pass, and every normalized row and Bundle must equal the committed one; only the maps may differ. The golden CI job now builds the packages.
- **Known text differences until #97.** For MotuPatient, FirstOverview and Visit, `golden-generated-maps.test.ts` lists every difference: the single-row `identifier` block written inline (Option B), and Metastra's `subject-auto`/`encounter-auto` becoming `R-015`/`R-016` (#99). The verified text with exactly those substitutions applied must equal the generated text, comments and blank lines aside. HospitalStay and Fall have no differences.

## Addendum (2026-11-12): rule names are FHIR ids; uses as target (#120)

- `StructureMap.group.rule.name` is a FHIR `id` (`[A-Za-z0-9.-]{1,64}`). Value-map rule names replace other characters with `-` instead of `_`, are cut to 64 characters, and get the collision suffix after the cut, so the result never exceeds 64. `N/A`, `N A` and `N-A` now collide: `R-002-N-A`, `R-002-N-A2`, `R-002-N-A3`. `ruleName` accepts only FHIR ids.
- The created resource types are declared with `uses … as target` (ADR-0007 addendum).
