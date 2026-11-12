# Report to HL7 (draft)

`hl7-report.md` is the text of a report to HL7 about the two engine behaviours found in #134. It is
a draft for the maintainers to post (an issue on hapifhir/org.hl7.fhir.core or a Zulip post). When
it is posted, add the link here.

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
