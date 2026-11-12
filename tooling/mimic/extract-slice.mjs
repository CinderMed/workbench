// Extracts the long-format golden case (#105) from the MIMIC-IV Clinical Database Demo v2.2 and
// the MIMIC-IV Clinical Database Demo on FHIR v2.1.0 (PhysioNet, both ODbL v1.0). Run once by hand;
// the slice is committed in fixtures/fml-examples/mimic-iv-demo and never downloaded in CI.
//
// Usage: node tooling/mimic/extract-slice.mjs <demo hosp/ folder> <FHIR demo folder with
//        MimicPatient.ndjson.gz, MimicEncounter.ndjson.gz, MimicObservationLabevents.ndjson.gz>
//
// Selection (deterministic): patients 10031404, 10022281, 10019568; their admissions; for each,
// 20 lab events chosen in this order: every row with a text value (no valuenum), then rows without
// hadm_id, then rows with comments, then the lowest labevent_id; the d_labitems rows they use; and
// the FHIR demo's Patient, Encounter and lab Observation resources with the same identifiers.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const [hosp, fhir] = process.argv.slice(2).map((p) => resolve(p ?? ""));
const out = resolve(import.meta.dirname, "../../fixtures/fml-examples/mimic-iv-demo");
const SUBJECTS = ["10031404", "10022281", "10019568"];
const PER_SUBJECT = 20;

/** Minimal CSV reader for the demo files (RFC 4180, quoted fields). */
function parse(text) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
const quote = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const table = (name) => {
  const [header, ...rows] = parse(
    gunzipSync(readFileSync(join(hosp, `${name}.csv.gz`))).toString("utf8"),
  );
  return {
    header,
    rows: rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]))),
  };
};
const write = (file, header, rows) =>
  writeFileSync(
    file,
    [header, ...rows.map((r) => header.map((h) => quote(r[h])))]
      .map((r) => r.join(","))
      .join("\n") + "\n",
  );

const patients = table("patients");
const admissions = table("admissions");
const labevents = table("labevents");
const labitems = table("d_labitems");

const lab = [];
for (const subject of SUBJECTS) {
  const rows = labevents.rows
    .filter((r) => r.subject_id === subject)
    .sort((a, b) => Number(a.labevent_id) - Number(b.labevent_id));
  const picked = new Set();
  const take = (predicate) => {
    for (const r of rows) if (picked.size < PER_SUBJECT && predicate(r)) picked.add(r);
  };
  take((r) => r.valuenum === "" && r.value !== "");
  take((r) => r.hadm_id === "");
  take((r) => r.comments !== "");
  take(() => true);
  lab.push(...[...picked].sort((a, b) => Number(a.labevent_id) - Number(b.labevent_id)));
}
const items = new Set(lab.map((r) => r.itemid));

mkdirSync(join(out, "test-data"), { recursive: true });
mkdirSync(join(out, "mimic-on-fhir"), { recursive: true });
write(
  join(out, "test-data/patients.csv"),
  patients.header,
  patients.rows.filter((r) => SUBJECTS.includes(r.subject_id)),
);
write(
  join(out, "test-data/admissions.csv"),
  admissions.header,
  admissions.rows.filter((r) => SUBJECTS.includes(r.subject_id)),
);
write(join(out, "test-data/labevents.csv"), labevents.header, lab);
write(
  join(out, "test-data/d_labitems.csv"),
  labitems.header,
  labitems.rows.filter((r) => items.has(r.itemid)),
);

const ndjson = (name) =>
  gunzipSync(readFileSync(join(fhir, `${name}.ndjson.gz`)))
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const ids = (resource) => (resource.identifier ?? []).map((i) => i.value);
const hadms = new Set(
  admissions.rows.filter((r) => SUBJECTS.includes(r.subject_id)).map((r) => r.hadm_id),
);
const labIds = new Set(lab.map((r) => r.labevent_id));
const keep = {
  Patient: ndjson("MimicPatient").filter((r) => ids(r).some((v) => SUBJECTS.includes(v))),
  Encounter: ndjson("MimicEncounter").filter((r) => ids(r).some((v) => hadms.has(v))),
  Observation: ndjson("MimicObservationLabevents").filter((r) => ids(r).some((v) => labIds.has(v))),
};
for (const [type, resources] of Object.entries(keep)) {
  resources.sort((a, b) => ids(a)[0].localeCompare(ids(b)[0], "en", { numeric: true }));
  writeFileSync(
    join(out, `mimic-on-fhir/${type}.ndjson`),
    resources.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
}
console.log(
  `patients ${SUBJECTS.length}, admissions ${hadms.size}, labevents ${lab.length}, labitems ${items.size}; FHIR: ${Object.entries(
    keep,
  )
    .map(([t, r]) => `${t} ${r.length}`)
    .join(", ")}`,
);
