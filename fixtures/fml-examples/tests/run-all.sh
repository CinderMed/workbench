#!/usr/bin/env bash
# Runs every check on the examples. Usage: VALIDATOR=/path/to/validator_cli.jar bash tests/run-all.sh
set -u; cd "$(dirname "$0")/.."
J=${VALIDATOR:?set VALIDATOR to the path of validator_cli.jar}; ok=0; ko=0
[ -f tools/java/RunMap.class ] || javac -proc:none -cp "$J" tools/java/RunMap.java 2>&1 | grep -v JAVA_TOOL
rm -f metastra/test-data/*bundle*.json motu/test-data/bundle-*.json
run(){ # folder map input output expected_entries [external-refs]
  node tools/normalize.mjs "$1/normalization-$2.json" "$1/test-data/$3.csv" > "$1/test-data/$3.normalized.json" 2>/dev/null
  res=$(java -Xmx2g -cp "$J:tools/java" RunMap "$1" "http://example.org/fhir/$1/StructureMap/$2" "$1/test-data/$3.normalized.json" "$1/test-data/$4.json" 2>&1 | grep -E "Bundle validation|\[error\]")
  n=$(python3 -c "import json;print(len(json.load(open('$1/test-data/$4.json')).get('entry',[])))")
  err=$(echo "$res" | sed -nE 's/.*Bundle validation: ([0-9]+) errors.*/\1/p')
  if [ "$n" = "$5" ] && { [ "$err" = "0" ] || [ "${6:-}" = "external-refs" ]; }; then ok=$((ok+1)); s=OK; else ko=$((ko+1)); s=FAILED; fi
  printf '%-8s %-12s %-22s entries=%s (expected %s) errors=%s %s\n' "$s" "$1" "$3" "$n" "$5" "$err" "${6:-}"
}
run metastra FirstOverview sample-row expected-bundle 6
run metastra FirstOverview negative-row negative-bundle 1
run motu MotuPatient MotuPatient bundle-MotuPatient 1
run motu HospitalStay HospitalStay bundle-HospitalStay 1 external-refs
run motu Fall Fall bundle-Fall 1 external-refs
run motu Fall Fall-invalid bundle-Fall-invalid 0
python3 - <<'PY'
import json
b={"resourceType":"Bundle","type":"transaction","entry":[]}
for t in ['MotuPatient','HospitalStay','Fall']: b['entry']+=json.load(open(f'motu/test-data/bundle-{t}.json'))['entry']
json.dump(b,open('motu/test-data/bundle-merged.json','w'),indent=2)
PY
m=$(java -Xmx2g -jar "$J" motu/test-data/bundle-merged.json -version 4.0.1 -tx n/a 2>&1 | grep -E "^(Success|\*FAILURE\*)")
echo "MOTU merged (order MotuPatient → HospitalStay → Fall): $m"
echo "$m" | grep -q "0 errors" && ok=$((ok+1)) || ko=$((ko+1))
echo "Total: $ok passed, $ko failed"
