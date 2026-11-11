#!/usr/bin/env bash
# Golden check on the verified examples.
#
# fixtures/fml-examples/tests/run-all.sh writes its outputs next to its inputs and always exits 0,
# so it runs on a copy in .tmp/golden (tests never write into fixtures/). The check fails unless
# every case passes and every file the suite regenerates (normalized rows, Bundles) is identical
# to the committed one.
#
# Usage: VALIDATOR=/abs/path/validator_cli.jar bash tooling/golden/run-examples.sh
set -euo pipefail
: "${VALIDATOR:?set VALIDATOR to the absolute path of validator_cli.jar}"

root=$(cd "$(dirname "$0")/../.." && pwd)
source_dir="$root/fixtures/fml-examples"
out="$root/.tmp/golden"
work="$out/fml-examples"
expected_checks=8

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
