#!/usr/bin/env bash
# HL7 probe (#134): which element names the HL7 engine accepts in FML and FHIRPath, and whether
# delimited identifiers survive compilation to StructureMap JSON. Runs every probe map with the HL7
# engine and with the mapping.g4 check, joins the results into .tmp/hl7-probes/results.tsv and
# compares them with expected-<validator version>.tsv. Exit 1 if they differ: the engine behaves
# differently from the recorded version (better or worse); read the diff and update the notes.
# Needs Java 21 and @cindermed/fml built (pnpm --filter @cindermed/fml build).
#
# Usage: VALIDATOR=/abs/path/validator_cli-<version>.jar bash tooling/hl7-probes/run.sh [version]
set -euo pipefail
: "${VALIDATOR:?set VALIDATOR to the absolute path of validator_cli.jar}"
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
version=${1:-7.0.5}
out="$root/.tmp/hl7-probes"
rm -rf "$out"
mkdir -p "$out/classes"

javac -proc:none -cp "$VALIDATOR" -d "$out/classes" "$here/Probe.java" 2>&1 | grep -v JAVA_TOOL || true
java -Xmx2g -cp "$VALIDATOR:$out/classes" Probe "$here/ig" "$here/maps" "$here/rows/full.json" "$here/rows/empty.json" \
  2>"$out/engine.log" | grep -P '^(map|P\d\d)' >"$out/engine.tsv"
node "$here/grammar-check.mjs" >"$out/grammar.tsv"

python3 - "$here/cases.json" "$out/engine.tsv" "$out/grammar.tsv" >"$out/results.tsv" <<'PY'
import csv, json, sys
cases = json.load(open(sys.argv[1]))
engine = {r["map"]: r for r in csv.DictReader(open(sys.argv[2]), delimiter="\t")}
grammar = {r["map"]: r["grammar"] for r in csv.DictReader(open(sys.argv[3]), delimiter="\t")}
print("\t".join(["map", "name", "case", "mapping.g4", "hl7 compile", "run from text (full | empty)",
                 "expression in JSON", "run from JSON (full | empty)"]))
for c in cases:
    e = engine[c["map"]]
    print("\t".join([c["map"], c["name"], c["case"], grammar[c["map"]], e["compile"], e["fromText"],
                     e["jsonExpression"], e["fromJson"]]))
PY

expected="$here/expected-$version.tsv"
if diff -u "$expected" "$out/results.tsv" >"$out/diff.txt"; then
  echo "hl7-probes: $(($(wc -l <"$out/results.tsv") - 1)) maps behave as recorded in $(basename "$expected")"
else
  echo "hl7-probes: results differ from $(basename "$expected") (see $out/results.tsv):" >&2
  cat "$out/diff.txt" >&2
  exit 1
fi
