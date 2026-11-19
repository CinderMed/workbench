# ADR-0019: Coding from a code column

- Status: accepted
- Date: 2026-11-19
- Module: 3 (FHIR definitions and validation)

## Context

In long tables a column often holds the code itself: MIMIC-IV `labevents.itemid` is a code of `d_labitems`, with hundreds of values. A value map needs one entry per code, and the generator writes one FML rule per entry, each evaluated on every row. Issue #105 decided a transform that writes `cc(<fixed system>, value)`, with the display from another column of the same row or none, and no `translate()`. The plan for project format 1.4.0 (approved 2026-11-19) fixed the shape: `{ kind: "coding", system, as: "Coding" | "CodeableConcept", displayColumnId? }`.

## Decision

- **Contract (project format 1.4.0).** A new transform, `coding`:
  - `system` (canonical) is required;
  - `as` (`Coding` or `CodeableConcept`) is required: the type written;
  - `displayColumnId` (a column of the same table) is optional.

  Integrity rules 1 and 3 check the display column like the other columns a row reads.

- **Translation rule.** The value is written with the type created explicitly, as the quantity transform does:

  ```
  src.itemid as v -> res.code = create('CodeableConcept') as cn then {
    v -> cn.coding = create('Coding') as cd then {
      v -> cd.system = '<system>', cd.code = v "R-010-code";
      src.label as d -> cd.display = d "R-010-display";
    } "R-010-coding";
  } "R-010";
  ```

  - For `as: Coding` the `cn` level is left out: `res.class = create('Coding') as cd then { … }`.
  - Typed creation is what makes it work on a choice element (`valueCodeableConcept`). Writing `cc(...)` to the base name would leave the type to the engine (#156).
  - The display rule fires only when the display column has a value.
  - As for quantities, the target must be a top-level element of the role, or the top of a named slice. A deeper path is `PATH_UNSUPPORTED`.

- **Not `cc()`.** The FML subset's `cc()` takes literal arguments only, and the typed block works on choice elements.
- **Types (ADR-0015).**
  - The column is string, categorical or integer (`TYPE_MISMATCH` on `columnId` otherwise).
  - `as` must be the element's type (`TYPE_MISMATCH` on `transform.as`).
  - It is written with a typed create, so there is no engine limit on choice elements.
- **Bindings (ADR-0016).** The column's allowed values, missing values left out, are checked as codes of `system` against the element's binding, on the row's `columnId`.

## Checked with the HL7 engine

The MIMIC-IV Labevents map was generated with R-010 as a coding instead of the 46-entry value map. Validator 7.0.5 ran it on the 60 real rows:

- every Observation has the same system and code as with the value map;
- the codes are strings, although `itemid` is an integer column;
- with a display column, the display is written on the 55 rows that have one and left out on the 5 that do not.

The `Coding` form also ran on `Encounter.class`. The golden case is the next, dedicated fixtures PR: the MIMIC-IV example switches `itemid` to this transform.

## Consequences

- A long code list costs one rule instead of one per code.
- Without a display column the Coding has no display. Displays from a code table (`d_labitems`) need a join (B12, Future) or a value map.
- Nested targets (`component.code`, outside a named slice) come with #125 in module 3b.
