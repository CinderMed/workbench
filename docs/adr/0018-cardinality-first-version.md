# ADR-0018: Cardinality checks, first version

- Status: accepted
- Date: 2026-11-19
- Module: 3 (FHIR definitions and validation)

## Context

The specification says (Cardinality):

- a single column towards a repeating element is allowed;
- several values towards a single element are an error (`CARDINALITY_MISMATCH`);
- two rows writing the same non-repeating element of the same role are an error unless their conditions are mutually exclusive (`DUPLICATE_TARGET`).

Deciding exclusivity in general needs an analysis of conditions. The user decided on 2026-11-18 to start simple: conditions are exclusive only when they compare the same column against different values, and otherwise `DUPLICATE_TARGET` is a warning that asks the user to check the conditions.

## Decision

`checkCardinality` in `@cindermed/fhir-defs` (`cardinality.ts`), run by `validateFhir`:

- **`CARDINALITY_MISMATCH`** (error, on the row's `repeat`): a `multipleChoice` column written through a value map without `repeat: eachValue`.
- **`DUPLICATE_TARGET`** (**warning** in this first version, on the later write):
  - **Same element:** two writes in the same role reach the same element when their paths resolve to the same snapshot elements, with the same slices. A choice counts once, whatever its concrete name (`valueQuantity`, `valueString`). Only single-valued elements count; writes to an element that repeats do not clash.
  - **Writes:** mapping rows, and fixed values, which are always written.
  - **Exclusive writes:** two writes are exclusive when one column is needed differently by them. A write needs:
    - a value in the column it reads (copy, cast, value map, quantity), because it writes only when that column has a value;
    - from its condition: specific values (`equals`, `in`), any value (`notEmpty`), or no value (`empty`), also inside `and`.

    The writes are exclusive when one needs no value where the other needs one, or both need disjoint lists of values. `or`, `not`, `notEquals`, `notIn` and expressions are not analysed.
- **Counting absence as a value.** Reading "the same column against different values" to include present against empty was needed: the MIMIC-IV example writes `valueQuantity` from `valuenum`, and `valueString` only when `valuenum` is empty. Without it, this verified example would get two false warnings.

## Consequences

- The specification's table lists `DUPLICATE_TARGET` as an error. It is a warning until a full analysis of conditions can tell exclusive writes apart reliably; then it can become an error again.
- The verified examples get no cardinality finding.
