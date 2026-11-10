# CinderMed: model → FML translation examples (verified)

These files are the reference material for modules 1–3 of CinderMed (FHIR Mapping Workbench). They show, on two real
datasets, how a project file is translated into FML and how the result is checked. The scripts in `tools/` are
verification prototypes, not the final generator, which will be written in TypeScript.

## Contents
- `mapping-project.schema.json` — project file schema, format 1.2.0
- `normalization.schema.json` — normalization specification schema (1.0.0): deterministic per-row algorithms
- `manifest.schema.json` — schema of the exported package manifest (1.0.0)
- `generator/` — the generator contract in TypeScript
  - `fml-ast.ts` — types of the syntax tree of the generated FML subset
  - `fml-print.ts` — deterministic printer (reference prototype)
  - `example-hospitalstay.ts` — tree of the MOTU HospitalStay map; printed, it is exactly `motu/HospitalStay.map`
- `metastra/` — 1 table (FirstOverview), 6 roles, 11 variables
- `motu/` — 3 linked tables (MotuPatient, HospitalStay, Fall), references across tables
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
  Italian number and boolean formats, FML reserved words

## Reproduce
1. Grammar: `npx antlr-ng -Dlanguage=TypeScript -o tools/gen grammar/mapping.g4`, then
   `npx tsx tools/verify-grammar.ts metastra/*.map motu/*.map`
2. Normalization: `node tools/normalize.mjs metastra/normalization-FirstOverview.json metastra/test-data/sample-row.csv`
3. HL7 engine (validator_cli.jar 7.0.5 from github.com/hapifhir/org.hl7.fhir.core/releases):
   `javac -proc:none -cp validator_cli.jar tools/java/RunMap.java`
   `java -cp validator_cli.jar:tools/java RunMap metastra http://example.org/fhir/metastra/StructureMap/FirstOverview metastra/test-data/sample-row.normalized.json out.json`
   Needs the hl7.fhir.r4.core#4.0.1 package in the ~/.fhir/packages cache (downloaded automatically when online).
4. Generator types: `cd generator && npx tsc -p tsconfig.json`, then `npx tsx example-hospitalstay.ts` prints `motu/HospitalStay.map`.

Full suite: `VALIDATOR=/path/to/validator_cli.jar bash tests/run-all.sh` (7 checks, including negative cases and a row
with an impossible date).

## Results (9 November 2026)
- Official grammar: 4/4 maps OK
- HL7 engine: every transform ran
- R4 validation: Metastra full row 0 errors (11 best-practice warnings); negative row 0 errors (creates only Patient);
  MOTU, three Bundles merged, 0 errors; Fall row with an impossible date → no resource (correct)
- Suite: 7 of 7 passed
- TypeScript: `tsc --strict` with no errors; the HospitalStay map printed from the tree is byte-identical to the file
  and passes every check

Note: these checks ran offline, with a copy of the R4 definitions taken from npm and a few empty auxiliary packages;
use the official packages in production.
