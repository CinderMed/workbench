# ADR-0007: StructureMap JSON built from the syntax tree

- Status: accepted
- Date: 2026-11-11
- Module: 2 (Generator and package)

## Context

The generator contract lists, for every table, the StructureMap "as FML, plus JSON compiled by the HL7 engine", and the manifest schema requires the JSON file (`tables[].structureMap.json`). The HL7 engine is Java. The export runs in the API and the CLI without Java, and Matchbox compilation only comes in V2 (G10). So in the MVP nobody can produce the JSON the way the verified examples did.

The verified examples hold the JSON the HL7 validator 7.0.5 compiled from each map (`fixtures/fml-examples/*/StructureMap-*.json`). The compiled form is regular:

- `id` and `name` are the map name. It has no `status` and no metadata, because the printed FML has none.
- The narrative is the FML text, XML-escaped inside `<pre>`.
- Constants become a `copy` transform with a `value[x]` parameter; variables become `valueId`.
- Conditions and `evaluate` expressions are FHIRPath re-rendered by the engine. The `where` clause keeps its outer parentheses, and when `=` sits next to `and`/`or`, its operands are grouped: `($this = '1') or ($this = '-1')`.

## Decision

- `packages/fml` builds the StructureMap JSON from the same syntax tree it prints (`toStructureMap(map, { fhirRelease })`). The result must equal what the HL7 engine compiles from the printed text. Key order and whitespace may differ: the engine's JSON formatting is not reproduced.
- FHIRPath in the JSON is rendered by a dedicated function (`renderFhirPath`) that copies the engine's grouping for the expression nodes the generator can build. Expert expressions (`raw`, D6) are copied as written, because the engine may format them differently.
- `status` is not added, so the JSON stays equal to the engine's output that was verified with the Bundles.
- R4 follows the verified examples. R5 follows the R5 StructureMap structure: no `contextType`, no `typeMode`, and the arguments of a dependent rule as `parameter` (`valueId`). The R5 form is not yet checked by the HL7 engine, because the verified examples are R4 only.
- Tests compare the JSON of every verified map with the compiled fixture. The CI golden job (`ci/golden-tests`) checks generated maps against the engine itself.

## Consequences

- The export needs no Java and no network, and its output is deterministic.
- Each new node in the syntax tree also needs its JSON form and a comparison with the engine's output.
- If the engine changes how it compiles or renders FHIRPath (a new validator version, or Matchbox in V2), the fixtures and this function have to follow. In V2, when Matchbox compiles every export, we can replace the built JSON with the compiled one; we will revisit then.
- A golden case on an R5 project is needed before R5 exports are relied on (module 3, when R5 definitions are loaded).

## Addendum (2026-11-11, review of PR #77)

- **`status`.** The JSON always has `status: "draft"`. FHIR requires it and the transform does not read it, so the verified Bundles stay valid. This replaces the decision above not to add it. Comparisons with the compiled fixtures and with the engine's output ignore only this field.
- **Comparison with the engine in CI.** In `ci/golden-tests`, every golden case compares the built JSON with the JSON the HL7 engine compiles, in CI, from the printed FML, not only with the stored fixtures.
- **Manifest.** Built JSON is not compiled JSON: the manifest keeps `verification.compile` = `"skipped"`.
