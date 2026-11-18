# ADR-0015: Type compatibility checks

- Status: accepted
- Date: 2026-11-13
- Module: 3 (FHIR definitions and validation)

## Context

D7 checks that each row's transform produces a value of the target element's type. The specification ("Type compatibility in the grid") gives a table for direct copies, a table for the other transforms, rules for complex elements and choices, and the result codes. Its done-when for `v0.3.0` asks that `cindermed validate` flags a boolean column copied to `Patient.name`, and that every cell of the table is tested in R4 and R5.

Some points are left open: which code a cell "allowed with a warning" gets, which casts are allowed besides those listed, how constants match, R5's `integer64`, where each finding points, and when the export runs the check.

## Decision

`checkRowTypes` and `checkValueType` in `@cindermed/fhir-defs` (`type-compat.ts`) implement the two tables. `validateFhir` runs them on every path that resolves (ADR-0014): mapping rows, fixed values, slice discriminator values and value-action values.

**Direct copy.** The specification's table, one rule per column type:

| Outcome                                                                                                                                                                                                                                                            | Code                                                                                                                                                | Severity |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Allowed                                                                                                                                                                                                                                                            | none                                                                                                                                                | none     |
| Allowed with a warning (string → code, id, uri, url, canonical; integer → positiveInt, unsignedInt, decimal; categorical → code, string)                                                                                                                           | `TYPE_PRECISION`                                                                                                                                    | warning  |
| Needs a transform: quantity (integer or decimal → Quantity), cast to string (→ string, markdown), value map (boolean → code, string, Coding, CodeableConcept; categorical → Coding, CodeableConcept, boolean; multipleChoice → anything, with `repeat: eachValue`) | `TYPE_NEEDS_TRANSFORM`, naming the transform                                                                                                        | error    |
| Another complex type                                                                                                                                                                                                                                               | `COMPLEX_TARGET`, listing the elements of that type the column fits, one level down (`name.family, name.given, name.text`)                          | error    |
| Anything else                                                                                                                                                                                                                                                      | `TYPE_MISMATCH`, with the reason the specification gives (an integer would lose the decimals, the time would be lost, an instant needs a time zone) | error    |

- `TYPE_PRECISION` covers every cell allowed with a warning, the format cases included. The specification defines it as a possible loss or out-of-range value, and an invalid code or URI is the same kind of risk.
- **integer64** (R5 only, not in the specification's table) accepts an integer column like `integer`. The alternative would be a false error.

**Other transforms.**

- **Cast.** It may convert to string, to the same type (reformatting a date), from integer to decimal, or from date to dateTime. Any other conversion is `TYPE_MISMATCH` on `transform.to`. The output is then checked like a copy of the target type, so a date cast to dateTime cannot go to a `date` element.
- **Value map.** The map's target (`code`, `Coding`, `CodeableConcept`, `boolean`) must equal the element's type.
- **Quantity.** It needs an integer or decimal column (on `columnId`), and an element of type Quantity or derived from it (Age, Duration, Distance, Count, SimpleQuantity).
- **Concatenation.** It takes string, categorical, integer or decimal columns (each on `transform.columnIds.i`), into string or markdown.
- **Constant, fixed value, value action.** `FhirValue.type` must equal the element's type. The one exception is a Quantity into a Quantity-derived type. The specification asks for an exact match, so a `string` constant on a `markdown` element is refused.
- **Reference.** It needs a Reference element (or `CodeableReference` in R5). Whether the target type is allowed is F4.
- **Expert expression.** Never type-checked: a permanent warning `EXPRESSION_NOT_TYPE_CHECKED`. The specification describes it without naming a code.

**Choices.** When the path names a choice under the wrong concrete type, the message proposes the concrete names that fit. For example: "a constant boolean … use valueBoolean"; an integer on `component.valueQuantity` … "use component.valueInteger".

**Where a finding points.**

- On the row: `path` for mismatches, complex targets and warnings; `transform` when a transform is needed; `transform.to`, `transform.value`, `columnId` or `transform.columnIds.i` for problems inside the transform.
- Typed values point to their own `value` field (`fixedValues.i.value`, `slices.i.discriminator.j.value`, `entries.i.action.set.j.value`).

**Export.**

- `exportPackage` takes an optional `definitions`. With it, the FHIR level runs and its errors block the export, as the specification requires. Its warnings are returned with the quality warnings.
- `cindermed export` loads the definitions as `validate` does (`--offline`, `--fhir-cache`, `--no-fhir`).
- The manifest does not record whether the FHIR checks ran: that would change the manifest schema (a contract).

**Tested.**

- `tooling/fhir-type-compat.test.ts` checks every cell, on real elements of each type, in R4 and R5: 858 cases. Its expected outcomes are written from the specification, separately from the code's table.
- The verified examples give no finding at all.
- The boolean on `Patient.name` gives `COMPLEX_TARGET` through `cindermed validate`.

## Consequences

- **Cardinality is not in this ADR.** `CARDINALITY_MISMATCH` and `DUPLICATE_TARGET` (two rows on the same non-repeating element without mutually exclusive conditions) need an analysis of row conditions. They are a separate step.
- **Bindings** (`BINDING_VIOLATION`) are the next branch.
- **Golden cases.** The specification asks that every combination the table allows has a golden case before it is enabled. The verified examples cover:
  - copies string → string and markdown, integer → integer, decimal → decimal, date → date and dateTime;
  - casts to date and dateTime;
  - decimal → Quantity;
  - value maps to code, Coding, CodeableConcept and boolean;
  - constants of type uri, code, Coding and CodeableConcept;
  - references.

  The other allowed combinations are type-checked here, but not yet proved end to end by the HL7 engine.

- Revisit `TYPE_PRECISION` for the format cases if users need to tell a range risk from a format risk.

## Addendum (2026-11-18): cells turned off until the generator writes choice elements with a type (#156)

The type-combinations golden case (#157) ran every combination the table allows through the generator and the HL7 engine. Some give an invalid resource, a valid one of the wrong type, or a StructureMap that does not validate. As decided, they are turned off rather than worked around in the generator, until #156 is fixed with golden cases:

- **On a choice element, a value of another type than the chosen one** (`TYPE_MISMATCH`). The generator writes the base name (`res.value = v`), and the engine takes the type of the value written: the column's type in the logical model (categorical and multipleChoice are strings), or the literal's (quoted for string, code, uri, date and dateTime). So these are off on a choice element, while they still work on an element that is not a choice:
  - a cast to string from integer, decimal, boolean, date or dateTime;
  - a copy of a date to `…DateTime`, or of an integer to `…Decimal`;
  - a dateTime constant.
- **A quantity into a type derived from Quantity** (Age, Duration, Distance, Count; `TYPE_MISMATCH`). The generator writes `create('Quantity')`. Quantity itself and its profiles (SimpleQuantity) are fine.
- **A Quantity constant** (`TYPE_MISMATCH`): the FML subset cannot write it, and the generator already refused it at export.
- **A reference into a choice element** (`TYPE_MISMATCH`).
- **Choice names the generator gets wrong** (`PATH_UNSUPPORTED`, in the export). The generator still names choice elements from a fixed list of R4 names (ADR-0011): `Immunization.doseQuantity` is not a choice but is written `dose`, and `protocolApplied.doseNumber[x]` or `prediction.probability[x]` are missing from the list. It also writes a path through a choice (`valueQuantity.value`) without a type. `@cindermed/export` compares the name the generator writes with the definitions and blocks the paths that differ, with the generator's own code.

`tooling/fhir-type-compat.test.ts` encodes these limits in its expectations, written separately from the code, and the verified examples are not affected.
