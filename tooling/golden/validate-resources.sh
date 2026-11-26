#!/usr/bin/env bash
# Validates every FHIR resource of the verified examples with the HL7 validator, in each example's
# FHIR version (R4, or R5 for r5-visit with the pinned R5 terminology package, #78), with no
# terminology server, each example folder loaded as an implementation guide so maps and logical
# models resolve: logical models, compiled StructureMaps, ConceptMaps and the produced Bundles.
# Every resource must validate with 0 errors (warnings are reported, not fatal).
#
# Bundles whose references point to another table (MOTU HospitalStay and Fall, MIMIC-IV demo
# Admissions and Labevents) resolve only together: they are validated through the committed
# bundle-merged.json of their folder (in load order), not alone.
#
# Usage: VALIDATOR=/abs/path/validator_cli.jar bash tooling/golden/validate-resources.sh
set -euo pipefail
: "${VALIDATOR:?set VALIDATOR to the absolute path of validator_cli.jar}"

root=$(cd "$(dirname "$0")/../.." && pwd)
fixtures="$root/fixtures/fml-examples"
out="$root/.tmp/golden-resources"
patterns=("StructureDefinition-*.json" "StructureMap-*.json" "ConceptMap-*.json" "test-data/*bundle*.json")
# Validated through bundle-merged.json (references across tables).
cross_table=("motu/test-data/bundle-HospitalStay.json" "motu/test-data/bundle-Fall.json"
  "mimic-iv-demo/test-data/bundle-Admissions.json" "mimic-iv-demo/test-data/bundle-Labevents.json")

rm -rf "$out"
mkdir -p "$out"
status=0
for folder in "$fixtures"/*/; do
  name=$(basename "$folder")
  files=()
  for pattern in "${patterns[@]}"; do
    for file in "$folder"$pattern; do
      [ -f "$file" ] || continue
      relative=${file#"$fixtures"/}
      [[ " ${cross_table[*]} " == *" $relative "* ]] && continue
      files+=("$file")
    done
  done
  [ ${#files[@]} -eq 0 ] && continue
  version=$(node -e 'console.log(require(process.argv[1]).project.fhirVersion)' "$folder/project.json")
  extra=()
  # R5 core does not carry the terminology code systems: the same pinned package as RunMap.java.
  [[ "$version" == 5.* ]] && extra=(-ig "hl7.terminology.r5#6.2.0")
  # Two runs: the logical models, then everything else. Validated in the same run before a
  # StructureMap, a logical model makes validator 7.0.5 report each `evaluate(src, …)` on it as
  # "Unknown context" (#98); validated alone, the same StructureMap has no error.
  models=()
  others=()
  for file in "${files[@]}"; do
    case "$(basename "$file")" in
      StructureDefinition-*) models+=("$file") ;;
      *) others+=("$file") ;;
    esac
  done
  log="$out/$name.log"
  : >"$log"
  for batch in models others; do
    declare -n list=$batch
    [ ${#list[@]} -eq 0 ] && continue
    java -jar "$VALIDATOR" "${list[@]}" -version "$version" -tx n/a -ig "$folder" "${extra[@]}" >>"$log" 2>&1 || true
    unset -n list
  done
  results=$(grep -E "^(Success|\*FAILURE\*):" "$log" || true)
  if [ "$(echo "$results" | grep -c .)" -ne ${#files[@]} ]; then
    echo "validate: $name: expected ${#files[@]} results, see $log" >&2
    status=1
  fi
  if echo "$results" | grep -vq "^Success: 0 errors"; then
    echo "validate: $name: errors in FHIR resources:" >&2
    grep -E "^-- |^\*FAILURE\*|^  Error" "$log" >&2
    status=1
    continue
  fi
  echo "validate: $name: ${#files[@]} resources, 0 errors"
done
exit $status
