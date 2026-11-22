# HL7 probes

Repeatable checks of how the HL7 engine (validator CLI) behaves where the workbench depends on it.
Run them again when the validator version changes:

- **Element names** (#134): how the engine treats element names in FML and FHIRPath, to see whether
  the element-name rule (specification, "Element names"; ADR-0009) is still needed or still enough.
- **R5 compile** (#78): which engine defects of the closed list in
  `tooling/golden/compare-structuremap.mjs` the R5 compilation still shows, to see when the list can
  shrink (ADR-0007 addendum), and whether the engine runs an R5 map from its text, from its own
  compilation and from our JSON.

## Element names

The probe uses no example or patient data: one logical model (`ig/`), two synthetic rows (`rows/`)
and one small map per case (`maps/`).

### What it checks

For each element name in `make-maps.py` (`NAMES`), five maps use the name:

| Case                 | FML                                       |
| -------------------- | ----------------------------------------- |
| `where`              | `src where ($this.a_b.exists()) -> …`     |
| `where-delimited`    | ``src where ($this.`a_b`.exists()) -> …`` |
| `evaluate`           | `… res.id = evaluate(src, $this.a_b)`     |
| `evaluate-delimited` | ``… res.id = evaluate(src, $this.`a_b`)`` |
| `source`             | `src.a_b as v -> …`                       |

For each map, `run.sh` records:

- **mapping.g4**: the official grammar check (`parseFml`, the parser behind `checkGrammar`).
- **hl7 compile**: the HL7 parser, the one the `compile` command uses.
- **run from text**: the Patient ids the map creates from `rows/full.json` and from
  `rows/empty.json` (`none` if it creates none).
- **expression in JSON**: the FHIRPath expression as written into the StructureMap JSON.
- **run from JSON**: the same two runs, after the map is written to StructureMap JSON and read
  back. This is how a map runs when it is loaded from an export package or from a FHIR server.

### Results with validator 7.0.5 (`expected-7.0.5.tsv`)

- The HL7 FHIRPath lexer rejects a name whose second character is `_`, or that starts with `_`,
  in both `where` and `evaluate`: `Found a_b expecting a token name` (`Found _ …` for `_a`).
  One-letter names (`a`, `X`) are accepted. mapping.g4 accepts every name.
- Delimited identifiers (`` $this.`a_b` ``) are accepted by both parsers and run from the map text,
  but the StructureMap JSON keeps the expression without backticks (`$this.a_b.exists()`), so the
  map fails with the same error when it runs from JSON. They are not a fix.
- Names that the element-name rule gives for the rejected ones (`ca_b`, `cx_`, `cc_a`, `cc__mood`)
  pass every case.

## R5 compile

`r5-compile.sh` takes the R5 golden case (`fixtures/fml-examples/r5-visit`, synthetic, read only):
the HL7 engine compiles its map with `-version=5.0.0`, the compilation is validated as R5 and
compared with our R5 JSON (`compare-structuremap.mjs`), and the engine runs the map three ways with
`RunMap`. The results go to `.tmp/hl7-probes/r5/results.tsv` and are compared with
`expected-r5-<version>.tsv`.

Results with validator 7.0.5 (`expected-r5-7.0.5.tsv`):

- The compilation has 111 errors as an R5 StructureMap (`element` as one-item arrays, an unknown
  `resourceDefinition`), and shows all six listed defects; nothing else differs from our JSON.
- The engine runs the map correctly from the `.map` text, from its own compilation and from our
  JSON: the three Bundles are the committed one, with 0 errors in R5. A `.map` loaded as text (as on
  a FHIR server that compiles FML) works; only the compiled JSON is invalid as a resource.

When a later validator shows fewer defects, remove them from `R5_ENGINE_DEFECTS` and from the
ADR-0007 addendum, in the PR that upgrades the validator.

## Reports to HL7

`report/` holds two drafts of reports to HL7, with minimal reproductions on the core `Basic`
resource and no data: the element-name findings (#134) and the R5 compile (#78). See
`report/README.md`.

## Run

`run.sh` runs both probes. Needs Java 21 and `@cindermed/fml` built (`pnpm --filter @cindermed/fml build`).

```sh
VALIDATOR=/abs/path/validator_cli-7.0.5.jar bash tooling/hl7-probes/run.sh
```

The element-name results go to `.tmp/hl7-probes/results.tsv` and are compared with
`expected-7.0.5.tsv`; the R5 results go to `.tmp/hl7-probes/r5/` (above). `r5-compile.sh` also runs alone.

## A new validator version

Run with the new jar and the version as argument:

```sh
VALIDATOR=/abs/path/validator_cli-<version>.jar bash tooling/hl7-probes/run.sh <version>
```

Without an `expected-<version>.tsv` (or `expected-r5-<version>.tsv`) the comparison fails and prints
the whole table. Read it, copy `.tmp/hl7-probes/results.tsv` to `expected-<version>.tsv` (and
`.tmp/hl7-probes/r5/results.tsv` to `expected-r5-<version>.tsv`), and if the behaviour changed,
update the notes above and open an issue about the element-name rule or the R5 defect list.

To add a name or a case, edit `make-maps.py`, run `python3 tooling/hl7-probes/make-maps.py` and
commit the regenerated files with the updated expected table.
