# Reports to HL7 (drafts)

Two drafts for the maintainers to post (an issue on hapifhir/org.hl7.fhir.core or a Zulip post). When
one is posted, add the link here.

## The FHIRPath lexer and delimited identifiers (#134)

`hl7-report.md` is the text of a report to HL7 about the two engine behaviours found in #134.

The three maps are the reproduction it describes: one map per folder, on the core `Basic` resource,
with no data and no custom definitions. Run them from this folder with validator 7.0.5 and Java 21:

```sh
cd tooling/hl7-probes/report
for map in Repro1 Repro2 Control; do
  folder=$(echo "$map" | tr '[:upper:]' '[:lower:]')
  java -jar /abs/path/validator_cli-7.0.5.jar compile "http://example.org/StructureMap/$map" \
    -version=4.0.1 -tx=n/a -ig="$folder" -output="$PWD/../../../.tmp/hl7-report/$map.json"
done
```

- `Repro1` is ignored with `Found a_b expecting a token name`, and `compile` still exits with 0.
- `Repro2` (`` $this.`a_b` ``) compiles, but its JSON has `"condition" : "($this.a_b.exists())"`.
- `Control` (`ab_c`) compiles.

The full probe (`../run.sh`) covers more names and positions and runs the maps on data.

## The R5 compile (#78)

`hl7-report-r5-compile.md` reports that `compile -version=5.0.0` writes a StructureMap that does not
validate as R5, and the differences between the R4 and the R5 compilations. `r5compile/R5Compile.map`
is its reproduction, on the core `Basic` resource, with no data:

```sh
cd tooling/hl7-probes/report
java -jar /abs/path/validator_cli-7.0.5.jar compile http://example.org/StructureMap/R5Compile \
  -version=5.0.0 -tx=n/a -ig=r5compile -output="$PWD/../../../.tmp/hl7-report/R5Compile.json"
java -jar /abs/path/validator_cli-7.0.5.jar ../../../.tmp/hl7-report/R5Compile.json -version 5.0.0 -tx n/a
```

With 7.0.5 the validation gives 4 errors (`element` as arrays, `resourceDefinition`). Compiled with
`-version=4.0.1` instead, the rule keeps its name `copy-id`. The probe `../r5-compile.sh` checks the
same on the R5 golden case, and runs the map.
