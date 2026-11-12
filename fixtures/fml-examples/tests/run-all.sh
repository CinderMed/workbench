#!/usr/bin/env bash
# Runs every check on the examples. Usage: VALIDATOR=/path/to/validator_cli.jar bash tests/run-all.sh
set -u; cd "$(dirname "$0")/.."
J=${VALIDATOR:?set VALIDATOR to the path of validator_cli.jar}; ok=0; ko=0
[ -f tools/java/RunMap.class ] || javac -proc:none -cp "$J" tools/java/RunMap.java 2>&1 | grep -v JAVA_TOOL
rm -f metastra/test-data/*bundle*.json motu/test-data/bundle-*.json boolean-value-map/test-data/bundle-*.json mimic-iv-demo/test-data/bundle-*.json
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
# onInvalidValue = fail (normalization 1.1.0): the conversion stops at the first invalid value,
# reports it and writes no rows; valid rows are normalized exactly as with report-drop.
fout=$(node tools/normalize.mjs tests/fall-fail.json motu/test-data/Fall-invalid.csv 2>/dev/null); fcode=$?
ferr=$(node tools/normalize.mjs tests/fall-fail.json motu/test-data/Fall-invalid.csv 2>&1 >/dev/null)
vout=$(node tools/normalize.mjs tests/fall-fail.json motu/test-data/Fall.csv 2>/dev/null)
if [ "$fcode" -ne 0 ] && [ -z "$fout" ] && echo "$ferr" | grep -q 'AdmissionDate: invalid value "31/02/2023" for date (onInvalidValue: fail)' \
   && [ "$vout" = "$(cat motu/test-data/Fall.normalized.json)" ]; then ok=$((ok+1)); s=OK; else ko=$((ko+1)); s=FAILED; fi
printf '%-8s %-12s %-22s exit=%s rows=%s\n' "$s" "motu" "Fall-invalid (fail)" "$fcode" "$([ -z "$fout" ] && echo 0 || echo some)"
# Italian yes/no column (Sì/No): categorical + value map to boolean → Observation.valueBoolean.
# The map is printed from a syntax tree (packages/fml/src/test-support/boolean-value-map.ts).
run boolean-value-map Visit visit-si bundle-visit-si 2
run boolean-value-map Visit visit-no bundle-visit-no 2
run boolean-value-map Visit visit-empty bundle-visit-empty 1
b=$(python3 -c "
import json
v=lambda f:[e['resource'].get('valueBoolean') for e in json.load(open(f))['entry'] if e['resource']['resourceType']=='Observation']
print(v('boolean-value-map/test-data/bundle-visit-si.json'), v('boolean-value-map/test-data/bundle-visit-no.json'))")
if [ "$b" = "[True] [False]" ]; then ok=$((ok+1)); s=OK; else ko=$((ko+1)); s=FAILED; fi
printf '%-8s %-12s %-22s Sì → %s, No → %s\n' "$s" "boolean" "valueBoolean" "${b%% *}" "${b##* }"
# Allowed values (normalization 1.2.0): "sì" is not one of the allowed values Sì/No (case-sensitive),
# so with onInvalidValue = fail the conversion stops instead of creating an Observation without a value.
aout=$(node tools/normalize.mjs boolean-value-map/normalization-Visit.json boolean-value-map/test-data/visit-si-lowercase.csv 2>/dev/null); acode=$?
aerr=$(node tools/normalize.mjs boolean-value-map/normalization-Visit.json boolean-value-map/test-data/visit-si-lowercase.csv 2>&1 >/dev/null)
if [ "$acode" -ne 0 ] && [ -z "$aout" ] && echo "$aerr" | grep -q 'fumatore: value "sì" is not an allowed value (onInvalidValue: fail)'; then ok=$((ok+1)); s=OK; else ko=$((ko+1)); s=FAILED; fi
printf '%-8s %-12s %-22s exit=%s rows=%s\n' "$s" "boolean" "sì not allowed (fail)" "$acode" "$([ -z "$aout" ] && echo 0 || echo some)"
python3 - <<'PY'
import json
b={"resourceType":"Bundle","type":"transaction","entry":[]}
for t in ['MotuPatient','HospitalStay','Fall']: b['entry']+=json.load(open(f'motu/test-data/bundle-{t}.json'))['entry']
json.dump(b,open('motu/test-data/bundle-merged.json','w'),indent=2)
PY
m=$(java -Xmx2g -jar "$J" motu/test-data/bundle-merged.json -version 4.0.1 -tx n/a 2>&1 | grep -E "^(Success|\*FAILURE\*)")
echo "MOTU merged (order MotuPatient → HospitalStay → Fall): $m"
echo "$m" | grep -q "0 errors" && ok=$((ok+1)) || ko=$((ko+1))
# Long table (#105): MIMIC-IV demo slice, one Observation per lab event row. Each file is normalized
# into an array of rows; RunMap joins the Bundles of the rows. References cross tables, so the three
# Bundles are validated together, in load order Patients → Admissions → Labevents.
run mimic-iv-demo Patients patients bundle-Patients 3
run mimic-iv-demo Admissions admissions bundle-Admissions 3 external-refs
run mimic-iv-demo Labevents labevents bundle-Labevents 60 external-refs
python3 - <<'PY'
import json
b={"resourceType":"Bundle","type":"transaction","entry":[]}
for t in ['Patients','Admissions','Labevents']: b['entry']+=json.load(open(f'mimic-iv-demo/test-data/bundle-{t}.json'))['entry']
json.dump(b,open('mimic-iv-demo/test-data/bundle-merged.json','w'),indent=2)
PY
mm=$(java -Xmx2g -jar "$J" mimic-iv-demo/test-data/bundle-merged.json -version 4.0.1 -tx n/a -ig mimic-iv-demo 2>&1 | grep -E "^(Success|\*FAILURE\*)")
echo "MIMIC-IV demo merged (order Patients → Admissions → Labevents): $mm"
echo "$mm" | grep -q "0 errors" && ok=$((ok+1)) || ko=$((ko+1))
echo "Total: $ok passed, $ko failed"
