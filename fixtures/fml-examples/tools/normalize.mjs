// Deterministic normalization (specification normalization.schema.json 1.1.0).
// Reference prototype for the conversion module tests, not production code.
// Usage: node normalize.mjs spec.json rows.csv > out.json     (errors on stderr)
import fs from 'fs'; import crypto from 'crypto';

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const inp = { delimiter: ',', quote: '"', encoding: 'utf-8', headerRow: 1, ...spec.input };
const onInvalid = spec.onInvalidValue ?? 'report-drop';

// --- CSV (RFC 4180) ---
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === inp.quote) { if (text[i + 1] === inp.quote) { cur += ch; i++; } else q = false; } else cur += ch; }
    else if (ch === inp.quote) q = true;
    else if (ch === inp.delimiter) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
let text = fs.readFileSync(process.argv[3], inp.encoding.startsWith('utf-8') ? 'utf8' : 'latin1');
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
const table = parseCsv(text).filter(r => r.some(c => c !== ''));
const header = table[inp.headerRow - 1].map(h => h.normalize('NFC').trim());
const data = table.slice(inp.headerRow);

// --- conversions ---
const canon = s => s.normalize('NFC').trim();
function parseDate(v, fmt, withTime) {
  let re = '', order = [];
  for (const tok of (fmt ?? (withTime ? 'yyyy-MM-ddTHH:mm:ss' : 'yyyy-MM-dd')).match(/yyyy|MM|dd|HH|mm|ss|./g)) {
    if (['yyyy', 'MM', 'dd', 'HH', 'mm', 'ss'].includes(tok)) { re += tok === 'yyyy' ? '(\\d{4})' : '(\\d{2})'; order.push(tok); }
    else re += tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const m = new RegExp('^' + re + '$').exec(v); if (!m) return null;
  const p = Object.fromEntries(order.map((k, i) => [k, Number(m[i + 1])]));
  if (!('yyyy' in p)) return null;
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  if (!('MM' in p)) return pad(p.yyyy, 4);                                // year only
  if (p.MM < 1 || p.MM > 12) return null;
  if (!('dd' in p)) return `${pad(p.yyyy, 4)}-${pad(p.MM)}`;
  const d = new Date(Date.UTC(p.yyyy, p.MM - 1, p.dd));
  if (d.getUTCMonth() !== p.MM - 1 || d.getUTCDate() !== p.dd) return null; // e.g. 31/02
  const date = `${pad(p.yyyy, 4)}-${pad(p.MM)}-${pad(p.dd)}`;
  if (!withTime || !('HH' in p)) return date;
  if (p.HH > 23 || (p.mm ?? 0) > 59 || (p.ss ?? 0) > 59) return null;
  return `${date}T${pad(p.HH)}:${pad(p.mm ?? 0)}:${pad(p.ss ?? 0)}`;
}
function convert(v, c) {
  switch (c.type) {
    case 'string': case 'code': return v;
    case 'integer': { if (!/^[+-]?\d+$/.test(v)) return undefined; const n = BigInt(v); return { json: n.toString(), canon: n.toString() }; }
    case 'decimal': {
      const s = (c.decimalSeparator === ',') ? v.replace(',', '.') : v;
      if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return undefined;
      const t = s.replace(/^\+/, '').replace(/^(-?)0+(?=\d)/, '$1');      // decimal digits kept
      return { json: t, canon: t };
    }
    case 'boolean': {
      const l = v.toLowerCase();
      if ((c.trueValues ?? ['1', 'true', 'yes', 'y']).map(x => x.toLowerCase()).includes(l)) return true;
      if ((c.falseValues ?? ['0', 'false', 'no', 'n']).map(x => x.toLowerCase()).includes(l)) return false;
      return undefined;
    }
    case 'date': case 'dateTime': { const d = parseDate(v, c.dateFormat, c.type === 'dateTime'); return d ?? undefined; }
  }
}
const canonStr = x => (typeof x === 'object' ? x.canon : String(x));

// --- rows ---
const out = [], errors = [];
data.forEach((cells, r) => {
  const raw = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  const obj = { resourceType: spec.logicalModel }, canonVals = {};
  let rejected = false;
  for (const c of spec.columns) {
    if (!(c.sourceName in raw)) continue;
    let v = canon(raw[c.sourceName]);
    if (v === '' || (c.missingValues ?? []).includes(v)) continue;
    const parts = c.multiValue ? [...new Set(v.split(c.multiValue.separator).map(canon).filter(Boolean))] : [v];
    const conv = [];
    for (const p of parts) {
      const x = convert(p, c);
      if (x === undefined) {
        const message = `row ${r + 1}, ${c.sourceName}: invalid value "${p}" for ${c.type}`;
        // fail (normalization 1.1.0): stop at the first invalid value, report it, write no rows.
        if (onInvalid === 'fail') { process.stderr.write(`${message} (onInvalidValue: fail)\n`); process.exit(1); }
        errors.push(message); if (onInvalid === 'reject-row') rejected = true; continue;
      }
      conv.push(x);
    }
    if (!conv.length) continue;
    obj[c.name] = c.multiValue ? conv : conv[0];
    canonVals[c.name] = c.multiValue ? conv.map(canonStr).join(',') : canonStr(conv[0]);
  }
  if (rejected) return;
  for (const f of spec.ids) {
    const vals = f.columns.map(n => canonVals[n]);
    if (vals.some(v => v === undefined)) continue;
    const sep = f.separator ?? '-';
    const tail = f.encoding === 'hash'
      ? crypto.createHash('sha256').update(vals.join('\u001f'), 'utf8').digest('hex').slice(0, f.hashLength ?? 24)
      : vals.join(sep).replace(/[^A-Za-z0-9.-]/g, '-');
    const id = [...f.literals.filter(Boolean), tail].join(sep);
    if (!/^[A-Za-z0-9.-]{1,64}$/.test(id)) { errors.push(`row ${r + 1}: invalid id for ${f.field}: ${id}`); continue; }
    obj[f.field] = id;
  }
  out.push(obj);
});
// JSON with numbers written with their original digits (decimal and integer)
const json = JSON.stringify(out.length === 1 ? out[0] : out, (k, v) => (v && typeof v === 'object' && 'json' in v) ? `\uE000${v.json}\uE000` : v, 2)
  .replace(/"\uE000([^\uE000]*)\uE000"/g, '$1');
process.stdout.write(json + '\n');
if (errors.length) process.stderr.write(errors.join('\n') + '\n');
