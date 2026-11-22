#!/usr/bin/env bash
# HL7 probe (#78): how the HL7 engine compiles and runs an R5 map. Takes the R5 golden case
# (fixtures/fml-examples/r5-visit: synthetic, read only) and records, in
# .tmp/hl7-probes/r5/results.tsv:
#   - whether `compile -version=5.0.0` succeeds, and how many errors its StructureMap JSON has
#     when validated as R5;
#   - which engine defects of the closed list (tooling/golden/compare-structuremap.mjs) it shows,
#     and whether anything else differs from our R5 JSON;
#   - the Bundle the engine makes from the .map text, from its own compilation and from our JSON:
#     entries, validation errors, and whether it equals the committed Bundle.
# The results are compared with expected-r5-<validator version>.tsv. Exit 1 if they differ: read
# the diff; a defect that disappears can leave the list (ADR-0007 addendum).
#
# Usage: VALIDATOR=/abs/path/validator_cli-<version>.jar bash tooling/hl7-probes/r5-compile.sh [version]
set -euo pipefail
: "${VALIDATOR:?set VALIDATOR to the absolute path of validator_cli.jar}"
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
version=${1:-7.0.5}
case_dir="$root/fixtures/fml-examples/r5-visit"
url="http://example.org/fhir/r5-visit/StructureMap/Visit"
out="$root/.tmp/hl7-probes/r5"
rm -rf "$out"
mkdir -p "$out/classes" "$out/compile" "$out/text" "$out/engine-json" "$out/our-json"

javac -proc:none -cp "$VALIDATOR" -d "$out/classes" "$root/fixtures/fml-examples/tools/java/RunMap.java" \
  >"$out/javac.log" 2>&1 || { grep -v JAVA_TOOL "$out/javac.log" >&2; exit 1; }

# 1. Compile from a folder with only the map and the logical model.
cp "$case_dir/Visit.map" "$case_dir/StructureDefinition-VisitRow.json" "$out/compile/"
if java -jar "$VALIDATOR" compile "$url" -version=5.0.0 -tx=n/a -ig="$out/compile" \
  -output="$out/engine.json" >"$out/compile.log" 2>&1 && [ -f "$out/engine.json" ]; then
  compiled=ok
else
  compiled=failed
fi

# 2. The compilation validated as an R5 StructureMap.
validation=-
if [ "$compiled" = ok ]; then
  java -jar "$VALIDATOR" "$out/engine.json" -version 5.0.0 -tx n/a -ig "$out/compile" \
    -ig "hl7.terminology.r5#6.2.0" >"$out/validate.log" 2>&1 || true
  validation=$(sed -nE 's/^(Success|\*FAILURE\*): ([0-9]+) errors.*/\2 errors/p' "$out/validate.log")
fi

# 3. The defects of the closed list it shows, and any other difference from our JSON.
defects=-
others=-
if [ "$compiled" = ok ]; then
  if node "$root/tooling/golden/compare-structuremap.mjs" "$out/engine.json" \
    "$case_dir/StructureMap-Visit.json" 5.0.0 >"$out/compare.log" 2>&1; then
    others=none
  else
    others=$(grep -c "differs:" "$out/compare.log" || true)
  fi
  defects=$(sed -nE 's/.*engine defects set aside: (.*)/\1/p' "$out/compare.log" | tr -d ' ' | tr ',' '\n' | sort | paste -sd, -)
  [ -n "$defects" ] || defects=none
fi

# 4. The engine runs the map: from the .map text, from its own compilation, from our JSON.
cp "$case_dir/Visit.map" "$out/text/"
[ "$compiled" = ok ] && cp "$out/engine.json" "$out/engine-json/StructureMap-Visit.json"
cp "$case_dir/StructureMap-Visit.json" "$out/our-json/"
run() { # folder → "entries=N errors=N same|different"
  local dir="$out/$1"
  cp "$case_dir/StructureDefinition-VisitRow.json" "$case_dir/ConceptMap-sex.json" "$dir/"
  local log
  log=$(java -Xmx2g -cp "$VALIDATOR:$out/classes" RunMap "$dir" "$url" \
    "$case_dir/test-data/visit.normalized.json" "$dir/bundle.json" 5.0.0 2>&1) || true
  echo "$log" >"$dir/run.log"
  [ -f "$dir/bundle.json" ] || { echo "error: $(echo "$log" | grep -m1 -E "Exception|Error" | cut -c1-120)"; return; }
  python3 - "$dir/bundle.json" "$case_dir/test-data/bundle-visit.json" "$log" <<'PY'
import json, re, sys
made, committed = (json.load(open(f)) for f in sys.argv[1:3])
errors = re.search(r"Bundle validation: (\d+) errors", sys.argv[3])
print(f"entries={len(made.get('entry', []))} errors={errors.group(1) if errors else '?'} "
      f"{'same as the committed Bundle' if made == committed else 'differs from the committed Bundle'}")
PY
}
from_text=$(run text)
from_engine=-
[ "$compiled" = ok ] && from_engine=$(run engine-json)
from_ours=$(run our-json)

{
  printf 'check\tresult\n'
  printf 'compile -version=5.0.0\t%s\n' "$compiled"
  printf 'compilation validated as R5\t%s\n' "$validation"
  printf 'listed defects shown\t%s\n' "$defects"
  printf 'other differences from our JSON\t%s\n' "$others"
  printf 'run from the .map text\t%s\n' "$from_text"
  printf 'run from the engine compilation\t%s\n' "$from_engine"
  printf 'run from our JSON\t%s\n' "$from_ours"
} >"$out/results.tsv"

expected="$here/expected-r5-$version.tsv"
if diff -u "$expected" "$out/results.tsv" >"$out/diff.txt"; then
  echo "hl7-probes: the R5 compile behaves as recorded in $(basename "$expected")"
else
  echo "hl7-probes: the R5 compile differs from $(basename "$expected") (see $out/results.tsv):" >&2
  cat "$out/diff.txt" >&2
  exit 1
fi
