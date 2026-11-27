// Builds the time-zone snapshot (#107, ADR-0024): for every IANA zone the Node runtime knows, its
// UTC offset on 1970-01-01 and each change of offset until 2300-01-01, from the tzdata bundled
// with Node's ICU (process.versions.tz). The snapshot is committed and changes only in a dedicated
// PR, so every machine writes the same normalization specifications whatever its Node version.
//
// Writes packages/export/src/time-zones/zones.json (offsets, used by the export) and
// packages/model/src/values/time-zone-names.json (names only, for validation in the browser too).
// Runs for a few minutes. Usage: node tooling/time-zones/build-zones.mjs
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const FROM = Date.UTC(1970, 0, 1) / 1000;
const TO = Date.UTC(2300, 0, 1) / 1000;
const DAY = 86400;

function offsetFn(zone) {
  const format = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" });
  return (seconds) => {
    const name = format
      .formatToParts(new Date(seconds * 1000))
      .find((p) => p.type === "timeZoneName").value;
    const m = /^GMT(?:([+-])(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(name);
    if (m === null) throw new Error(`${zone}: unexpected offset ${name}`);
    if (m[1] === undefined) return 0;
    return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] ?? 0));
  };
}

const zones = {};
// Intl lists the canonical zones without UTC, which a project may name; it is added last.
for (const zone of [...Intl.supportedValuesOf("timeZone"), "UTC"]) {
  const offset = offsetFn(zone);
  let previous = offset(FROM);
  const entry = [previous];
  // Daily steps, then a binary search to the second: a change and its reversal within one day
  // would be missed; tzdata has none since 1970.
  for (let t = FROM + DAY; t < TO; t += DAY) {
    const current = offset(t);
    if (current === previous) continue;
    let lo = t - DAY;
    let hi = t;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (offset(mid) === previous) lo = mid;
      else hi = mid;
    }
    entry.push(hi, current);
    previous = current;
  }
  zones[zone] = entry;
}

const tzdata = process.versions.tz;
const header = { tzdata, from: FROM, to: TO };
// One zone per line: diffs stay readable when tzdata is updated.
const lines = Object.entries(zones).map(
  ([zone, entry]) => `    ${JSON.stringify(zone)}: ${JSON.stringify(entry)}`,
);
writeFileSync(
  resolve(root, "packages/export/src/time-zones/zones.json"),
  `{\n  "tzdata": ${JSON.stringify(tzdata)},\n  "from": ${FROM},\n  "to": ${TO},\n  "zones": {\n${lines.join(",\n")}\n  }\n}\n`,
);
writeFileSync(
  resolve(root, "packages/model/src/values/time-zone-names.json"),
  `${JSON.stringify({ ...header, names: Object.keys(zones) }, null, 2)}\n`,
);
console.log(`tzdata ${tzdata}: ${String(Object.keys(zones).length)} zones`);
