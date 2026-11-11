// Memory probe for the streaming normalizer (run by tooling/normalizer-memory.test.ts, not alone).
// Generates ROWS rows in chunks, never stored or written to disk, streams them through
// @cindermed/normalizer (built dist) and prints the heap after a full GC at each checkpoint.
// Usage: node --expose-gc tooling/normalizer/memory-probe.mjs <rows>
import { createNormalizer, serializeRowNdjson } from "../../packages/normalizer/dist/index.js";

const rows = Number(process.argv[2] ?? 1_000_000);
const spec = {
  formatVersion: "1.2.0",
  source: "Lab",
  logicalModel: "http://example.org/StructureDefinition/LabRow",
  input: { format: "csv" },
  onInvalidValue: "report-drop",
  columns: [
    { name: "subject_id", sourceName: "subject_id", type: "string" },
    {
      name: "itemid",
      sourceName: "itemid",
      type: "string",
      allowedValues: ["50912", "50971", "51221"],
    },
    {
      name: "charttime",
      sourceName: "charttime",
      type: "dateTime",
      dateFormat: "yyyy-MM-dd HH:mm:ss",
    },
    { name: "valuenum", sourceName: "valuenum", type: "decimal" },
    { name: "valueuom", sourceName: "valueuom", type: "string" },
  ],
  ids: [
    {
      field: "id_Observation0",
      literals: ["obs"],
      columns: ["subject_id", "itemid", "charttime"],
      encoding: "hash",
    },
  ],
};
const items = ["50912", "50971", "51221"];
const units = ["mg/dL", "mEq/L", "%"];
const chunkRows = 5_000;

const created = createNormalizer(spec);
if (!created.ok) throw new Error(created.failure.message);
const normalizer = created.normalizer;
let normalized = 0;
let issues = 0;
let bytes = 0;
const consume = (events) => {
  for (const event of events) {
    if (event.kind === "row") bytes += serializeRowNdjson(event.row).length;
    else issues++;
    if (event.kind === "row") normalized++;
  }
};
const heap = () => {
  globalThis.gc();
  return process.memoryUsage().heapUsed;
};

consume(normalizer.push("subject_id,itemid,charttime,valuenum,valueuom\n"));
const checkpoints = [];
const start = Date.now();
for (let first = 0; first < rows; first += chunkRows) {
  let chunk = "";
  for (let i = first; i < Math.min(first + chunkRows, rows); i++) {
    const k = i % 3;
    const minute = String(i % 60).padStart(2, "0");
    chunk += `${10000000 + (i % 50000)},${items[k]},2180-07-23 12:${minute}:00,${(i % 997) / 10},${units[k]}\n`;
  }
  consume(normalizer.push(new TextEncoder().encode(chunk)));
  const done = Math.min(first + chunkRows, rows);
  if (done % (rows / 10) === 0) checkpoints.push({ rows: done, heap: heap() });
}
consume(normalizer.end());
console.log(
  JSON.stringify({
    rows: normalized,
    issues,
    bytes,
    seconds: (Date.now() - start) / 1000,
    checkpoints,
  }),
);
