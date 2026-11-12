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

## Addendum (2026-11-12): valid FHIR, fixture JSON with status (#120)

- The HL7 validator 7.0.5 reported errors in every compiled StructureMap. Two were real mistakes in the translation, and one came from the fixtures:
  - **Mode mismatch:** `The type 'Patient' has mode 'target' which doesn't match the structure definition mode of 'produced'` (an error). The role groups take the created resource as a `target` parameter, so the map declares those types with `uses … as target`. With `produced`, the validator also loses the type of the target variables and reports "The target context 'p' is not known at this point" for every rule that uses them. With `target`, every StructureMap validates with 0 errors, and the five maps, recompiled by the HL7 engine, give byte-identical Bundles.
  - **Invalid rule name:** `R-002-S_` is not a FHIR `id`, the type of `StructureMap.group.rule.name`. Rule names now use `-` and at most 64 characters, and the `ruleName` constructor rejects anything else (ADR-0011 addendum).
  - **Missing `status`:** the HL7 `compile` output has no `status`.
- **Fixture StructureMap JSON** is now the HL7 `compile` output (line endings normalized to LF) plus `"status" : "draft"`, inserted after `name`, which is what our builder writes. The golden comparisons no longer ignore `status`. Until #97 they ignore only `text`, whose `div` embeds the FML text.
- `tooling/golden/validate-resources.sh`, in the CI golden job, validates every FHIR resource of the examples with 0 errors: logical models, StructureMaps, ConceptMaps and Bundles. MOTU's HospitalStay and Fall Bundles are validated through `bundle-merged.json`, because their references cross tables.

## Addendum (2026-11-12): golden tests in CI (#76)

The CI golden job now proves the whole TypeScript chain, not only the stored fixtures:

1. **Verified examples:** `tests/run-all.sh` on the committed maps, with the reference normalizer.
2. **Export:** the real `cindermed export` (built CLI) on every example (`tooling/golden/export-examples.mjs`).
   - Maps, logical models and ConceptMaps are byte-identical to the fixtures; normalization specifications too, apart from `$schema`.
   - StructureMap JSON has the content of the HL7-compiled fixture.
   - The manifest is the committed one apart from `$schema`, `generator` and the digests of the files whose `$schema` differs, and every digest matches the exported bytes.
3. **Compile:** the HL7 engine compiles **every exported map in CI** (`tooling/golden/compile-check.sh`), from a folder holding only the map and the logical models. The result must equal the StructureMap JSON our builder wrote, **ignoring only `status`**: this is the condition of the first addendum. The manifest keeps `verification.compile = "skipped"`, because the package's JSON is built, not compiled.
4. **TypeScript pipeline:** a second run of the suite on a copy of the fixtures.
   - The exported maps and StructureMap JSON replace the committed ones.
   - The test CSVs go through `@cindermed/normalizer`, by way of `tooling/golden/normalize-ts.mjs`, which has the reference's command line and messages. `tests/run-all.sh` now reads the normalizer command from `NORMALIZE`.
   - All checks must pass, and maps, normalized rows and Bundles must equal the committed ones; the merged MOTU and MIMIC Bundles must have 0 errors. This replaces the earlier generated-maps pass (`generate-maps.mjs`, ADR-0011 addendum).

**Generative tests** (`packages/fml/src/generative.test.ts`): 300 seeded random projects (`test-support/random-projects.ts`).

- They are schema- and integrity-valid, and include the hard cases:
  - reserved words and `id`/`extension`/`resourceType` as column names, leading digits, accents, emoji, names over 64 characters and names that collide after sanitizing;
  - value-map values that collide as rule names, and very long values;
  - a long-format table with a code column, and `via` references.
- For every table they check that:
  - the map generates and prints deterministically, and passes the grammar check;
  - every rule name is a unique, valid FHIR id within its group;
  - the normalization specification validates against its schema;
  - no generated resource contains an empty string.
- **Nightly** (`nightly.yml`), the HL7 engine compiles the maps of seeds 1–20 and compares them with our JSON (`tooling/generative-compile.test.ts`). Compilation-level generative tests in the PR checks come in module 3.
- **First nightly result** (12 November 2026, run locally): 12 of the 20 seeds compile and match. Eight fail and are tracked:
  - **#134** (seeds 4, 14, 17, 20): the HL7 FHIRPath parser rejects element names whose second character is `_` (`a_b`, `c___`) inside `where`, although the grammar accepts them.
  - **#135** (seeds 1, 3, 16, 19): the narrative differs for characters outside the BMP (the engine writes `&#x1F600;`).

  Seeds 4, 14, 17 and 20 are listed as expected failures referencing #134 (`it.fails`): the job fails on any new failure, and on a known one that starts passing. Seeds 1, 3, 16 and 19 pass once #135 is fixed.
