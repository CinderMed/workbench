# ADR-0023: Element names and choice types from the FHIR definitions

- Status: accepted
- Date: 2026-11-21
- Module: 3b (long tables and publishing)
- Replaces: the "Choice elements" decision of ADR-0011

## Context

ADR-0011 named choice elements from a fixed list of R4 names, "until the FHIR definitions arrive". The generator wrote a choice element by its base name (`res.value = v`), so the HL7 engine took the type from the value written, not from the path (#156). Three things went wrong:

- **A value of another type on a choice.** A cast decimal → string on `valueString` gave `valueDecimal`. A date column on `effectiveDateTime` gave `effectiveDate`. A dateTime constant gave `effectiveString`. Some results were invalid, others valid but of the wrong type.
- **Names the list got wrong.** `Immunization.doseQuantity` is not a choice in R4, but the list wrote it as `dose`. `doseNumber` was missing from the list.
- **A path through a choice** (`valueQuantity.value`) and a quantity on `onsetAge` made the engine fail.

Until now, the type checks and the export turned these cells off (`TYPE_MISMATCH`, `PATH_UNSUPPORTED`).

The probes on #156 ran 52 hand-written maps through validator 7.0.5. For every cell, `create('<chosen type>')` makes the engine write the right element and value. That holds for primitives too: `create('string')` keeps `1.50` as `"1.50"`. `cast()` also works, but it is not among the transforms the specification allows (`create`, `copy`, `c`, `cc`, `evaluate`). The user approved the rule on #156.

## Decision

1. **Names from the definitions.** Every element name the generator writes comes from the FHIR definitions:
   - a choice element is written by its base name (`value`, `onset`, `doseNumber`);
   - any other element by its own name (`doseQuantity`).

   The fixed list is removed from the generator.

2. **A typed value on a choice.** When the value written to a choice element would not have the chosen type, it is written with that type: `res.value = create('<type>') as x, x.value = <value>`. The value's type is the one the engine sees:
   - the column's type, for a copy and for a cast, which is written as a copy;
   - the literal's type, for a constant, a fixed value or a value-map value;
   - the created type, for `c()`, `cc()` and `create()`.

   When the value already has the chosen type, the rule is written as before, so no existing map changes.

3. **A complex type on a choice.** A quantity on a choice is created with the chosen type (`create('Age')`). A path through a choice opens it with its type (`res.value = create('Quantity') as p`), inline and in a shared block, and a reference on a choice does the same (`create('Reference')`).
4. **`@cindermed/fml` stays independent of `@cindermed/fhir-defs`.**
   - The export (`packages/export/src/written-paths.ts`) resolves every path the generator writes, given by `pathsToWrite`: rows, fixed values, value-map `setElement` and `use.also`, slice discriminators.
   - For each segment it passes the generator plain data (`WrittenPaths`): the FML name and, on a choice, the chosen type.
   - `generateMap(project, plan, written)` stops on a path it was not given; the export resolves them all after the FHIR checks have passed.
   - dependency-cruiser keeps `packages/fml` from importing `fhir-defs`.
5. **The export always needs the definitions.** `ExportOptions.definitions` is required. `cindermed export` has no `--no-fhir`, and stops with the reason when the packages cannot be loaded. There is no fallback to a name list. `--no-fhir` stays for `validate`.
6. **Tests without disk access.** The export tests use a committed subset of the R4 definition index (`packages/export/src/test-support/r4-index.json`): the manifest, plus the 27 documents that exporting the fixture projects reads.
   - `tooling/export-test-index.test.ts` rebuilds the subset from the real core package (`FHIR_CORE_PACKAGES=1`) and fails if it differs. `UPDATE_TEST_INDEX=1` rewrites it.
   - The fml tests use an explicit list of the choice elements they use (`test-support/written-paths.ts`).
   - The golden suite exports every fixture with the real definitions and compares the maps.

## Consequences

- **Turning the cells back on.** The rule is in the generator, but the #156 cells stay turned off (`type-compat.ts`, `choice-paths.ts`) until the fixtures PR adds a golden case for each one, built by this generator and run by the HL7 engine. That PR adds a decimal with trailing zeros (`1.50` stays `"1.50"`) and a dateTime with an offset. It turns on only the cells it covers. The R5 versions come with #78.
- **Callers must pass the definitions.** Every caller of `exportPackage` gives definitions; `tooling/golden/write-fixture.mjs` loads them from the FHIR package cache.
- **Only choices are created.** A type derived from Quantity on an element that is not a choice (`Encounter.length`, a Duration) is still created as `Quantity`, which the engine accepts and the golden case covers.
