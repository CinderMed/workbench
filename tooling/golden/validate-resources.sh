#!/usr/bin/env bash
# Validates the FHIR resources of the verified examples with the HL7 validator (R4, no
# terminology server), each example folder loaded as an implementation guide so maps and logical
# models resolve. Every resource must validate with 0 errors (warnings are reported, not fatal).
#
# Kinds checked: ConceptMap-*.json. StructureDefinition-*Row.json and StructureMap-*.json join
# when the generator writes them as valid FHIR (#120).
#
# Usage: VALIDATOR=/abs/path/validator_cli.jar bash tooling/golden/validate-resources.sh
set -euo pipefail
: "${VALIDATOR:?set VALIDATOR to the absolute path of validator_cli.jar}"

root=$(cd "$(dirname "$0")/../.." && pwd)
fixtures="$root/fixtures/fml-examples"
out="$root/.tmp/golden-resources"
patterns=("ConceptMap-*.json")

rm -rf "$out"
mkdir -p "$out"
status=0
for folder in "$fixtures"/*/; do
  name=$(basename "$folder")
  files=()
  for pattern in "${patterns[@]}"; do
    for file in "$folder"$pattern; do [ -f "$file" ] && files+=("$file"); done
  done
  [ ${#files[@]} -eq 0 ] && continue
  log="$out/$name.log"
  java -jar "$VALIDATOR" "${files[@]}" -version 4.0.1 -tx n/a -ig "$folder" >"$log" 2>&1 || true
  results=$(grep -E "^(Success|\*FAILURE\*):" "$log" || true)
  if [ "$(echo "$results" | grep -c .)" -ne ${#files[@]} ]; then
    echo "validate: $name: expected ${#files[@]} results, see $log" >&2
    status=1
  fi
  if echo "$results" | grep -vq "^Success: 0 errors"; then
    echo "validate: $name: errors in FHIR resources:" >&2
    grep -E "^-- |^\*FAILURE\*|^  Error" "$log" >&2
    status=1
  fi
  echo "validate: $name: ${#files[@]} resources, 0 errors"
done
exit $status
