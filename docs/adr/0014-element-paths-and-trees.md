# ADR-0014: Element paths and element trees

- Status: accepted
- Date: 2026-11-13
- Module: 3 (FHIR definitions and validation)

## Context

D7 checks every mapping row's path against the role's resource or profile, F4 checks reference targets, and the path picker (D3, module 7) shows element trees. All three read the compact definition index (ADR-0013). The specification fixes the outline:

- choice types appear under their concrete names;
- a named slice is allowed only on a repeating element;
- extensions cannot be mapped;
- datatypes expand on request.

It leaves open how a project path meets the snapshot: slices the project names versus slices a profile defines, `contentReference`, prohibited elements, datatype profiles, and what each failure is called.

A project path (`ElementPath`) is relative to the role's resource, with segments separated by `.`, a choice under its concrete name (`valueQuantity`) and an optional named slice (`component[nrs]`).

## Decision

`@cindermed/fhir-defs` answers on the documents already loaded, synchronously:

- `resolvePath(defs, typeOrProfile, path)` returns the element and every segment with its cardinality;
- `elementTree(defs, typeOrProfile, path?)` returns one level of children;
- `referenceTargets(defs, typeOrProfile, path)` returns what a Reference allows.

**Walking a path.** At each segment, the children of the current element are, in this order:

1. the target of its `contentReference` (`#Questionnaire.item` in R4, `<url>#Questionnaire.item` in R5);
2. its inline children (backbone elements);
3. otherwise, when it has exactly one complex type, the children of that datatype's document.

A primitive type has no children, and neither does a choice used without its type.

**Choices.** `value[x]` matches `value` followed by the type name with an upper-case first letter (`valueQuantity`, `valueDateTime`). When a profile constrains one type with a type slice of that name (`value[x]:valueQuantity`), the slice is used, with its constraints.

**Slices.**

- `name[slice]` needs a repeating element (`max` `*` or more than 1).
- If the profile defines a slice with that name, the path uses it, with its cardinality, fixed and pattern values and children.
- Otherwise the slice is the project's own name for one repetition, and the base element is used.

**Refused**, each with a stable code (a stable code lets D7 point to the right cell, and a fixed message names the element):

| Code                      | When                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| `PATH_NOT_FOUND`          | No such element at this point (also: a path into a primitive)             |
| `CHOICE_TYPE_REQUIRED`    | A choice without its type (`value`); the message lists the concrete names |
| `SLICE_NOT_REPEATING`     | A named slice on an element that does not repeat                          |
| `EXTENSION_NOT_SUPPORTED` | `extension` or `modifierExtension`, anywhere in the path                  |
| `PATH_PROHIBITED`         | An element or slice the profile sets to `max` 0                           |
| `DEFINITION_UNKNOWN`      | The type or profile is not in the index                                   |
| `TYPE_NOT_LOADED`         | A document needed is not loaded yet; `type` names it                      |
| `NOT_A_REFERENCE`         | `referenceTargets` on an element that is not a Reference                  |

The result names the segment where resolution stopped.

**Element trees.** One level at a time:

- A choice gives one node per type.
- Extensions and prohibited elements are left out.
- Profile slices follow the element they slice (`category`, `category[VSCat]`).
- Each node says whether it is `expandable` (inline children, a complex datatype or a `contentReference`). The caller asks again with that node's path.

**Reference targets.**

- No target profile, or `Resource`, means any resource type.
- Otherwise, the base resource types of the targets. Target profiles that are resource profiles are also listed as `profiles`. Targets that are not in the index, or are not resources, go in `unknown`, so F4 can report them.
- `CodeableReference` (R5) counts as a Reference.

**Loading on demand.** `withDefinitions(defs, fetch, question)` asks a question, loads the one document it reports missing (`TYPE_NOT_LOADED`) and asks again until it answers. A document that fails to load stops it. In the browser, a path such as `valueCodeableConcept.coding.code` loads three documents: Observation, CodeableConcept and Coding.

## Consequences

- D7 (branch 3) maps these codes to validation results on the mapping row. The cardinality of every segment is there for the repeat checks.
- A path written for R4 can fail in R5 where an element was renamed, for example `Encounter.period` → `actualPeriod`. The tests check this case.
- **Datatype profiles are not followed.** A path into an element whose type names a profile (for example a Quantity constrained to SimpleQuantity) uses the base datatype. Following the profile needs its document and is a later decision, when IG profiles are in use.
- **Profile slice names and the project format.** `ElementPath` allows slice names matching `[a-z][A-Za-z0-9-]*`. Profile slices that start with an upper-case letter (`VSCat` in the vital signs profile, `SystolicBP` in the blood pressure profile) resolve here but cannot be written in a project file today. Changing the pattern is a contract change (project format). It belongs with named slices in the path picker (D4, module 7) and needs approval.
