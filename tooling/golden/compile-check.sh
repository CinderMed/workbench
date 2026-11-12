#!/usr/bin/env bash
# Golden step (#76, ADR-0007 addendum): the HL7 engine compiles, in CI, every map that the exported
# packages contain, from a folder with only the map and the logical models (an existing
# StructureMap JSON in the folder would be loaded instead of the map). The compiled JSON must equal
# the StructureMap JSON our builder wrote in the package, apart from `status`, which the compiler
# does not write.
#
# Usage: VALIDATOR=/abs/path/validator_cli.jar bash tooling/golden/compile-check.sh <export folder>
set -euo pipefail
: "${VALIDATOR:?set VALIDATOR to the absolute path of validator_cli.jar}"
export_dir=$(cd "$1" && pwd)
# Work folder next to the export folder (under .tmp/ in the golden suite), kept for inspection.
work="$(dirname "$export_dir")/compile-check"
rm -rf "$work"
mkdir -p "$work"
status=0
count=0
for package in "$export_dir"/*/; do
  url=$(node -e 'const m = require(process.argv[1]); for (const t of m.tables) console.log(t.structureMap.url + " " + t.structureMap.fml + " " + t.structureMap.json)' "$package/manifest.json")
  while read -r map_url fml json; do
    ig="$work/ig-$count"
    mkdir -p "$ig"
    cp "$package$fml" "$package"StructureDefinition-*.json "$ig/"
    java -jar "$VALIDATOR" compile "$map_url" -version=4.0.1 -tx=n/a -ig="$ig" -output="$work/compiled-$count.json" >"$work/compile-$count.log" 2>&1 || {
      echo "compile: $(basename "$package")/$fml: the HL7 engine did not compile it" >&2
      cat "$work/compile-$count.log" >&2
      status=1
      continue
    }
    if node -e '
      const fs = require("fs");
      const read = (f) => { const j = JSON.parse(fs.readFileSync(f, "utf8")); delete j.status; return j; };
      process.exit(require("util").isDeepStrictEqual(read(process.argv[1]), read(process.argv[2])) ? 0 : 1);
    ' "$work/compiled-$count.json" "$package$json"; then
      echo "compile: $(basename "$package")/$fml: the HL7 compilation equals our StructureMap JSON (status aside)"
    else
      echo "compile: $(basename "$package")/$fml: the HL7 compilation differs from our StructureMap JSON" >&2
      status=1
    fi
    count=$((count + 1))
  done <<< "$url"
done
[ "$count" -gt 0 ] || { echo "compile: no maps found under $export_dir" >&2; exit 1; }
echo "compile: $count maps checked"
exit $status
