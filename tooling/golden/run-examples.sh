#!/usr/bin/env bash
# Golden check on the verified examples.
#
# fixtures/fml-examples/tests/run-all.sh writes its outputs next to its inputs and always exits 0,
# so it runs on a copy in .tmp/golden (tests never write into fixtures/). The check fails unless
# every case passes and every file the suite regenerates (normalized rows, Bundles) is identical
# to the committed one.
#
# A second pass replaces the maps with the ones the generator produces and checks the same rows and
# Bundles (needs the packages built: pnpm --filter "./packages/*" build).
#
# Usage: VALIDATOR=/abs/path/validator_cli.jar bash tooling/golden/run-examples.sh
set -euo pipefail
: "${VALIDATOR:?set VALIDATOR to the absolute path of validator_cli.jar}"

root=$(cd "$(dirname "$0")/../.." && pwd)
source_dir="$root/fixtures/fml-examples"
out="$root/.tmp/golden"
work="$out/fml-examples"
expected_checks=17

rm -rf "$out"
mkdir -p "$out"
cp -R "$source_dir" "$work"

bash "$work/tests/run-all.sh" 2>&1 | tee "$out/run-all.log"

if ! grep -qx "Total: $expected_checks passed, 0 failed" "$out/run-all.log"; then
  echo "golden: expected 'Total: $expected_checks passed, 0 failed'" >&2
  exit 1
fi

if ! diff -r --exclude='*.class' "$source_dir" "$work" >"$out/diff.txt"; then
  echo "golden: regenerated files differ from fixtures/fml-examples:" >&2
  cat "$out/diff.txt" >&2
  exit 1
fi

echo "golden: $expected_checks of $expected_checks checks passed; regenerated files match the fixtures"

# Second pass: the maps produced by the generator (@cindermed/fml) replace the committed ones. Since
# #97 the committed maps are generator output, so the .map files must be identical, and so must
# every normalized row and Bundle. The StructureMap JSON is excluded from this diff only because
# the committed one is in the HL7 engine's formatting; its content is compared exactly by
# packages/fml/src/golden-generated-maps.test.ts.
generated="$out/generated/fml-examples"
mkdir -p "$out/generated"
cp -R "$source_dir" "$generated"
node "$root/tooling/golden/generate-maps.mjs" "$generated" | tee "$out/generate-maps.log"
bash "$generated/tests/run-all.sh" 2>&1 | tee "$out/run-all-generated.log"

if ! grep -qx "Total: $expected_checks passed, 0 failed" "$out/run-all-generated.log"; then
  echo "golden (generated maps): expected 'Total: $expected_checks passed, 0 failed'" >&2
  exit 1
fi

if ! diff -r --exclude='*.class' --exclude='StructureMap-*.json' \
  "$source_dir" "$generated" >"$out/diff-generated.txt"; then
  echo "golden (generated maps): maps, normalized rows or Bundles differ from fixtures/fml-examples:" >&2
  cat "$out/diff-generated.txt" >&2
  exit 1
fi

echo "golden (generated maps): $expected_checks of $expected_checks checks passed; the generated maps are the committed ones and give the committed Bundles"
