# ADR-0016: Binding checks with ValueSets expanded offline

- Status: accepted
- Date: 2026-11-19
- Module: 3 (FHIR definitions and validation)

## Context

The specification ("Type compatibility in the grid", Binding) asks:

- for code, Coding or CodeableConcept elements with a `required` binding, every code the project produces (by a map, a constant or a copy) must belong to the ValueSet;
- the check uses the ValueSets of the core package;
- if a ValueSet cannot be expanded offline, the error becomes a warning;
- with an `extensible` or `preferred` binding, a code outside the ValueSet is a warning.

There is no terminology server until module 8. The browser checks with the compact definition index (ADR-0013), so the expansions must travel with it, one small document at a time.

## Decision

**Expansions in the index (format 1.1.0, a compatible minor version).**

- **Which ValueSets.** The index lists every ValueSet that a kept element binds with strength `required`, `extensible` or `preferred`, in `manifest.valueSets`, sorted by URL. The version suffix (`|4.0.1`) is ignored.
- **Expandable ones** have a document, `valueSets/<package>/<id>.json`, with every code grouped by code system, both sorted. Its manifest entry gives `file`, `sha256`, `size` and `count`.
- **The others** say why in `reason`. A ValueSet is expanded offline only from the packages loaded:
  - included concept lists;
  - whole code systems present with `content: complete`, nested concepts included;
  - included ValueSets, recursively;
  - excluded concept lists, removed;
  - a stored `expansion` when there is no `compose`.

  It cannot be expanded when it uses a filter, a code system that is missing or not complete, excludes a whole code system or a ValueSet, includes itself, or has more than 2,000 codes (documents stay small).

- **Measured on the core packages:**

  |     | Bound ValueSets | Expandable | Required, expandable | Largest document | Manifest |
  | --- | --------------- | ---------- | -------------------- | ---------------- | -------- |
  | R4  | 351             | 319        | 225 of 229           | 4.3 kB           | 184 kB   |
  | R5  | 431             | 334        | 250 of 265           | 4.3 kB           | 217 kB   |

  In R5, many ValueSets use code systems kept in `hl7.terminology.r5`, which is not loaded today.

**Which codes are checked.** For each use whose element is a code, Coding or CodeableConcept with a checked binding, these are the codes it writes:

- the `use` targets of its value map (a bare value, or a Coding);
- its constant;
- a fixed value, slice discriminator or value-action value;
- for a copy of a categorical column, the column's allowed values minus its missing values.

Elements of type `code` are compared by code only, since the system is implicit. Coding and CodeableConcept are compared by system and code. A string column copied to a code element has no known values, and its `TYPE_PRECISION` warning (ADR-0015) already covers it. Bindings are checked only when the value's type fits the element.

**Results** (`BINDING_VIOLATION`, the specification's code):

| Binding               | Code outside the ValueSet | ValueSet not expandable offline                 |
| --------------------- | ------------------------- | ----------------------------------------------- |
| required              | error                     | warning: "binding not checked", with the reason |
| extensible, preferred | warning                   | not reported                                    |
| example               | not checked               | not checked                                     |

**Where findings point.** Each finding goes on the object to change:

- the value-map entry (`entries.i.target`, or `entries.i.action.set.j.value`);
- the row's constant (`transform.value`);
- the fixed value or discriminator (`…value`);
- for a copied categorical column, the row (`columnId`): the column needs a value map, or other allowed values.

**Browser.** `loadProjectDefinitions` also loads the ValueSet documents of the project's bindings, so the browser gets the same findings as the CLI.

## Consequences

- No terminology server is needed for the bindings of the core package.
- Display names are not checked here: that is code verification (E4, module 8).
- **Loading time.** The loader also reads the ValueSets and CodeSystems of each package. Loading the R4 definitions takes about 3.7 s instead of 1.6 s.
- **Revisit** loading `hl7.terminology` with R5 projects, which would make most of the 15 unexpandable required R5 bindings checkable. Also revisit the 2,000-code cap if a binding a project uses is larger.
