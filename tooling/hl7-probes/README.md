# HL7 probes

A repeatable check of how the HL7 engine (validator CLI) treats element names in FML and FHIRPath.
It was written for #134. Run it again when the validator version changes, to see whether the
element-name rule (specification, "Element names"; ADR-0009) is still needed or still enough.

The probe uses no example or patient data: one logical model (`ig/`), two synthetic rows (`rows/`)
and one small map per case (`maps/`).

## What it checks

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

## Results with validator 7.0.5 (`expected-7.0.5.tsv`)

- The HL7 FHIRPath lexer rejects a name whose second character is `_`, or that starts with `_`,
  in both `where` and `evaluate`: `Found a_b expecting a token name` (`Found _ …` for `_a`).
  One-letter names (`a`, `X`) are accepted. mapping.g4 accepts every name.
- Delimited identifiers (`` $this.`a_b` ``) are accepted by both parsers and run from the map text,
  but the StructureMap JSON keeps the expression without backticks (`$this.a_b.exists()`), so the
  map fails with the same error when it runs from JSON. They are not a fix.
- Names that the element-name rule gives for the rejected ones (`ca_b`, `cx_`, `cc_a`, `cc__mood`)
  pass every case.

## Report to HL7

`report/` holds the draft of a report to HL7 about both findings, with a minimal reproduction (three
maps on the core `Basic` resource, no data). See `report/README.md`.

## Run

Needs Java 21 and `@cindermed/fml` built (`pnpm --filter @cindermed/fml build`).

```sh
VALIDATOR=/abs/path/validator_cli-7.0.5.jar bash tooling/hl7-probes/run.sh
```

The results go to `.tmp/hl7-probes/results.tsv` and are compared with `expected-7.0.5.tsv`.

## A new validator version

Run with the new jar and the version as argument:

```sh
VALIDATOR=/abs/path/validator_cli-<version>.jar bash tooling/hl7-probes/run.sh <version>
```

Without an `expected-<version>.tsv` the comparison fails and prints the whole table. Read it, copy
`.tmp/hl7-probes/results.tsv` to `expected-<version>.tsv`, and if the behaviour changed, update the
notes above and open an issue about the element-name rule.

To add a name or a case, edit `make-maps.py`, run `python3 tooling/hl7-probes/make-maps.py` and
commit the regenerated files with the updated expected table.
