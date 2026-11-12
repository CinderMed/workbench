#!/usr/bin/env bash
# Golden check on the verified examples.
#
# fixtures/fml-examples/tests/run-all.sh writes its outputs next to its inputs and always exits 0,
# so it runs on a copy in .tmp/golden (tests never write into fixtures/). The check fails unless
# every case passes and every file the suite regenerates (normalized rows, Bundles) is identical
# to the committed one.
#
# Then (#76): `cindermed export` on every example, compared with the fixtures; the HL7 engine compiles
# every exported map, compared with our StructureMap JSON; and a second pass runs the whole
# TypeScript pipeline (exported maps, TypeScript normalizer) and checks the same rows and Bundles.
# Needs the packages and the CLI built: pnpm --filter "./packages/*" --filter @cindermed/cli build.
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

# Export: the real `cindermed export` on every example; the packages must match the fixtures (#76).
node "$root/tooling/golden/export-examples.mjs" "$out/export" | tee "$out/export.log"

# Compile: the HL7 engine compiles every exported map; it must equal our StructureMap JSON.
bash "$root/tooling/golden/compile-check.sh" "$out/export" | tee "$out/compile.log"

# Second pass: the whole TypeScript pipeline. The exported packages' maps and StructureMap JSON
# replace the committed ones, and the TypeScript normalizer (@cindermed/normalizer) replaces the
# reference normalize.mjs. Every check must pass, and the maps, normalized rows and Bundles must
# equal the committed ones. The StructureMap JSON is excluded from this diff only because the
# committed one is the HL7 compilation, in the engine's formatting: the compile step above proved
# that their content is the same.
generated="$out/generated/fml-examples"
mkdir -p "$out/generated"
cp -R "$source_dir" "$generated"
for package in "$out"/export/*/; do
  name=$(basename "$package")
  cp "$package"*.map "$package"StructureMap-*.json "$generated/$name/"
done
NORMALIZE="node $root/tooling/golden/normalize-ts.mjs" bash "$generated/tests/run-all.sh" 2>&1 | tee "$out/run-all-generated.log"

if ! grep -qx "Total: $expected_checks passed, 0 failed" "$out/run-all-generated.log"; then
  echo "golden (TypeScript pipeline): expected 'Total: $expected_checks passed, 0 failed'" >&2
  exit 1
fi

if ! diff -r --exclude='*.class' --exclude='StructureMap-*.json' \
  "$source_dir" "$generated" >"$out/diff-generated.txt"; then
  echo "golden (TypeScript pipeline): maps, normalized rows or Bundles differ from fixtures/fml-examples:" >&2
  cat "$out/diff-generated.txt" >&2
  exit 1
fi

echo "golden (TypeScript pipeline): $expected_checks of $expected_checks checks passed with the exported packages and the TypeScript normalizer; maps, rows and Bundles match"
