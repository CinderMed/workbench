# CinderMed: model → FML translation examples (verified)

These files are the reference material for modules 1–3 of CinderMed (FHIR Mapping Workbench). They show, on two real
datasets, how a project file is translated into FML and how the result is checked. The scripts in `tools/` are
verification prototypes, not the final generator, which will be written in TypeScript.

## Contents
- `mapping-project.schema.json` — project file schema, format 1.3.0
- `normalization.schema.json` — normalization specification schema (1.2.0): deterministic per-row algorithms
- `manifest.schema.json` — schema of the exported package manifest (1.0.0)
- `generator/` — the generator contract in TypeScript
  - `fml-ast.ts` — types of the syntax tree of the generated FML subset
  - `fml-print.ts` — deterministic printer (reference prototype)
  - `example-hospitalstay.ts` — tree of the MOTU HospitalStay map; printed, it is exactly `motu/HospitalStay.map`
- `metastra/` — 1 table (FirstOverview), 6 roles, 11 variables
- `motu/` — 3 linked tables (MotuPatient, HospitalStay, Fall), references across tables
- `boolean-value-map/` — 1 table (Visit): an Italian yes/no column (`Sì`/`No`) is categorical, with a value map to
  boolean on `Observation.valueBoolean`. `Visit.map` is printed from the syntax tree in
  `packages/fml/src/test-support/boolean-value-map.ts` (not written by hand) and compiled with the HL7 engine
  - `project.json` — project file
  - `*.map` — StructureMaps in FML (written by applying the generator rules)
  - `StructureDefinition-*Row.json` — logical model of the normalized row
  - `ConceptMap-*.json` — value maps exported as documentation (the FML does not use them at run time)
  - `normalization-*.json` — normalization specification (dates, lists, missing values, ids)
  - `StructureMap-*.json` — StructureMaps compiled by the HL7 validator
  - `manifest.json` — package manifest: tables, load order, SHA-256 digests
  - `test-data/` — test CSV rows, normalized rows, produced Bundles
- `grammar/mapping.g4` — official FML grammar, HL7/mapping-language-ig commit 8bb04b4 (16 October 2026)
- `tools/` — prototypes used for verification
  - `artifacts.py` — project → logical model, ConceptMaps, normalization specification
  - `manifest.py` — package manifest and load order
  - `normalize.mjs` — CSV row → normalized JSON (Node)
  - `verify-grammar.ts` — parsing with mapping.g4 (antlr-ng + antlr4ng, TypeScript)
  - `java/RunMap.java` — runs a map with the HL7 engine and validates the Bundle
- `tests/` — the full suite plus focused cases: same id from different date formats, invalid values,
  Italian number and boolean formats, FML reserved words, `onInvalidValue: fail` (`fall-fail.json`)

## Reproduce
1. Grammar: `npx antlr-ng -Dlanguage=TypeScript -o tools/gen grammar/mapping.g4`, then
   `npx tsx tools/verify-grammar.ts metastra/*.map motu/*.map`
2. Normalization: `node tools/normalize.mjs metastra/normalization-FirstOverview.json metastra/test-data/sample-row.csv`
3. HL7 engine (validator_cli.jar 7.0.5 from github.com/hapifhir/org.hl7.fhir.core/releases):
   `javac -proc:none -cp validator_cli.jar tools/java/RunMap.java`
   `java -cp validator_cli.jar:tools/java RunMap metastra http://example.org/fhir/metastra/StructureMap/FirstOverview metastra/test-data/sample-row.normalized.json out.json`
   Needs the hl7.fhir.r4.core#4.0.1 package in the ~/.fhir/packages cache (downloaded automatically when online).
4. Generator types: `cd generator && npx tsc -p tsconfig.json`, then `npx tsx example-hospitalstay.ts` prints `motu/HospitalStay.map`.

Full suite: `VALIDATOR=/path/to/validator_cli.jar bash tests/run-all.sh` (12 checks, including negative cases, a row
with an impossible date, the same row stopping the conversion with `onInvalidValue: fail`, and the `Sì`/`No`
rows of `boolean-value-map` producing `valueBoolean` true and false).

## Results (9 November 2026)
- Official grammar: 4/4 maps OK
- HL7 engine: every transform ran
- R4 validation: Metastra full row 0 errors (11 best-practice warnings); negative row 0 errors (creates only Patient);
  MOTU, three Bundles merged, 0 errors; Fall row with an impossible date → no resource (correct)
- Suite: 7 of 7 passed (12 of 12 from 11 November 2026, see below)
- TypeScript: `tsc --strict` with no errors; the HospitalStay map printed from the tree is byte-identical to the file
  and passes every check

Note: these checks ran offline, with a copy of the R4 definitions taken from npm and a few empty auxiliary packages;
use the official packages in production.

## Format update (11 November 2026)
Project schema 1.3.0 and normalization schema 1.1.0 (compatible minor versions): columns may declare
`decimalSeparator`, `project.output.onInvalidValue` (`fail` by default) is written into every normalization
specification, and normalization 1.1.0 adds `onInvalidValue: fail`. Both example projects set
`onInvalidValue: report-drop`, the behaviour they were verified with. The logical models and normalization
specifications were regenerated with the TypeScript generator (`@cindermed/fml`): only `version` and
`formatVersion` changed. The suite passed 8 of 8 with the HL7 validator 7.0.5, and every produced Bundle is
identical to the verified one.

The decimal separator is strict (same day, normalization 1.1.0 not yet released): with `decimalSeparator: ","`
a value containing `.` (`1.234`, `1.234,5`) is invalid, and with `.` a value containing `,` is invalid.
`tools/normalize.mjs` applies it; no example data is affected and the suite gives the same Bundles.

Normalization schema 1.2.0 (compatible minor): the specification lists the allowed values of `categorical` and
`multipleChoice` columns (`allowedValues`), compared after NFC and trim, case-sensitive; a value outside the list
is an invalid value, so `onInvalidValue` applies. The five normalization specifications were regenerated with the
TypeScript generator (only `formatVersion` and `allowedValues` changed) and the manifests carry their new SHA-256.
`tests/fall-fail.json` stays at 1.1.0 on purpose. New check: `boolean-value-map/test-data/visit-si-lowercase.csv`
(`sì`, lower case) stops the conversion with `onInvalidValue: fail`. The suite passed 13 of 13 with the HL7
validator 7.0.5, and every produced Bundle is identical to the verified one.

## Golden case boolean-value-map (11 November 2026)
Booleans written as words are a categorical column with a value map to boolean (project 1.3.0, rule 9). The map
`boolean-value-map/Visit.map` is printed by `@cindermed/fml` from a syntax tree; the logical model and the
normalization specification come from the TypeScript generator. The HL7 validator 7.0.5 compiled the map
(`compile … -version=4.0.1 -tx=n/a -ig=boolean-value-map`, line endings normalized to LF like the other compiled
maps) and ran it on three rows: `Sì` → `valueBoolean: true`, `No` → `valueBoolean: false`, empty answer → no
Observation. All three Bundles validate with 0 errors (best-practice warnings only). Suite: 12 of 12.

## Canonical creation conditions (11 November 2026)
The hand-written `motu/Fall.map` and `metastra/FirstOverview.map` wrapped a role's single creation condition in
parentheses (`$this.id_AdverseEvent0.exists() and ($this.FallDate.exists())`). They are now in the printer's canonical
form, with parentheses only around a nested `and`/`or` (as in `motu/HospitalStay.map`): four conditions changed (Fall
AdverseEvent0; FirstOverview Encounter0, Observation1, Procedure0), nothing else. The HL7 validator 7.0.5 recompiled
`StructureMap-Fall.json` and `StructureMap-FirstOverview.json` from a folder without the old compiled JSON (the engine
otherwise loads the existing StructureMap instead of the `.map`); only the four `condition` strings and the narrative
changed. The manifests carry the new SHA-256. Suite: 13 of 13, every Bundle identical.

## WHATWG decoding (11 November 2026)
`tools/normalize.mjs` decodes the data file with `TextDecoder`, as the TypeScript reference `@cindermed/normalizer`
does (ADR-0010): `iso-8859-1` is read as windows-1252 (0x80 is `€`, not a C1 control character), and UTF-8 drops a
leading byte order mark. The normalization schema describes it under `input.encoding`. No example uses a single-byte
encoding, so no output changes; suite: 13 of 13.

## Metastra automatic references as rows (11 November 2026)
`metastra/FirstOverview.map` has two references for Observation[1] (haemoglobin), `subject` to Patient[0] and
`encounter` to Encounter[0], that had no mapping row in `metastra/project.json`. The generator never infers
references, so the project now has them as rows `R-015` and `R-016` (`reference`, `auto: true`), like the other
automatic references (`R-005`, `R-008`, `R-009`, `R-012`, `R-014`). The map, the logical model, the normalization
specification and the Bundles do not change; the manifest carries the new SHA-256 of `project.json`. The map's rule
names `subject-auto` and `encounter-auto` become `R-015` and `R-016` when the maps are regenerated by the generator
(#97). Suite: 13 of 13.
