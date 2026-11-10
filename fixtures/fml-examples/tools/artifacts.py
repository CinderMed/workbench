"""Generates the logical model, ConceptMaps and normalization specification from a project file (schema 1.2.0).
Prototype used to verify the translation rules, not the final generator (which will be TypeScript).
Usage: python3 artifacts.py <project.json> <output folder>"""
import json, sys, os, re
proj = json.load(open(sys.argv[1])); out = sys.argv[2]; os.makedirs(out, exist_ok=True)
base = proj['project']['canonicalBase']
FT = {'string':'string','integer':'integer','decimal':'decimal','date':'date','dateTime':'dateTime','boolean':'boolean','categorical':'string','multipleChoice':'string'}
inst = {i['id']: i for i in proj['instances']}
def key(i): return f"{i['resourceType']}{i['index']}"
def element_name(n, used):
    e = re.sub(r'[^A-Za-z0-9_]', '_', n)
    if not re.match(r'^[A-Za-z]', e): e = 'c' + e
    if e in ('share', 'default', 'log', 'then'): e += '_'
    base, k = e[:60], 2
    while e in used: e, k = f"{base}{k}", k + 1
    used.add(e); return e
for src in proj['sources']:
    name = src['name']; tname = f"{name}Row"; url = f"{base}/StructureDefinition/{tname}"
    els = [{"id": tname, "path": tname, "min": 0, "max": "*", "base": {"path": tname, "min": 0, "max": "*"}}]
    norm_cols = []; used = set(); elname = {}
    for c in src['columns']:
        c = dict(c, name=element_name(c['name'], used), originalName=c.get('originalName', c['name']))
        elname[c['id']] = c['name']
        multi = c['dataType'] == 'multipleChoice'
        els.append({"id": f"{tname}.{c['name']}", "path": f"{tname}.{c['name']}", "short": c.get('label', c['name'])[:120],
                    "definition": c.get('description') or c.get('label') or c['name'], "min": 0, "max": "*" if multi else "1",
                    "base": {"path": f"{tname}.{c['name']}", "min": 0, "max": "*" if multi else "1"}, "type": [{"code": FT[c['dataType']]}]})
        nc = {"name": c['name'], "sourceName": c['originalName'], "type": FT[c['dataType']]}
        for k in ('dateFormat', 'missingValues'):
            if k in c: nc[k] = c[k]
        if 'multiValue' in c:
            if c['multiValue']['encoding'] != 'delimited':
                raise SystemExit(f"multiValue '{c['multiValue']['encoding']}' not supported in the MVP (column {c['name']})")
            nc['multiValue'] = {"separator": c['multiValue']['separator']}
        norm_cols.append(nc)
    # id fields: roles of this table + roles referenced by rows of this table (also in other tables, through 'via')
    colname = {c['id']: c['name'] for s2 in proj['sources'] for c in s2['columns']}
    rels = {r['id']: r for r in proj.get('sourceRelations', [])}
    needed = {i['id']: None for i in proj['instances'] if i['sourceId'] == src['id']}
    for m in proj['mappings']:
        t = m['transform']
        if t['kind'] == 'reference' and inst[m['instanceId']]['sourceId'] == src['id']:
            needed.setdefault(t['targetInstanceId'], t.get('via'))
    ids = []
    for iid, via in needed.items():
        i = inst[iid]; f = f"id_{key(i)}"
        cmap = {}
        if via:
            r = rels[via]; cmap = dict(zip(r['to']['columnIds'], r['from']['columnIds']))
        cids = [cmap.get(p['columnId'], p['columnId']) for p in i['idRule']['parts'] if 'columnId' in p]
        assert all(c in elname for c in cids), f"id columns of {key(i)} not present in {name}: {cids}"
        cols = [elname[c] for c in cids]
        els.append({"id": f"{tname}.{f}", "path": f"{tname}.{f}", "short": f"Computed id of {i['resourceType']}[{i['index']}]",
                    "definition": f"Deterministic id of the resource of role {i['resourceType']}[{i['index']}] ({i.get('label','')}), computed by the normalization.",
                    "min": 0, "max": "1", "base": {"path": f"{tname}.{f}", "min": 0, "max": "1"}, "type": [{"code": "id"}]})
        r = i['idRule']
        ids.append({"field": f, "literals": [p['literal'] for p in r['parts'] if 'literal' in p], "columns": cols,
                    "encoding": r.get('encoding', 'hash'), "hashLength": r.get('hashLength', 24), "separator": r.get('separator', '-')})
    sd = {"resourceType": "StructureDefinition", "id": tname, "url": url, "version": proj['formatVersion'], "name": tname,
          "title": f"Normalized row of table {name}", "status": "draft", "fhirVersion": proj['project']['fhirVersion'],
          "kind": "logical", "abstract": False, "type": url,
          "baseDefinition": "http://hl7.org/fhir/StructureDefinition/Base" if proj['project']['fhirVersion'].startswith('5') else "http://hl7.org/fhir/StructureDefinition/Element",
          "derivation": "specialization", "snapshot": {"element": els}, "differential": {"element": els}}
    json.dump(sd, open(f"{out}/StructureDefinition-{tname}.json", 'w'), ensure_ascii=False, indent=2)
    imp = src.get('import', {})
    json.dump({"$schema": "../normalization.schema.json", "formatVersion": "1.0.0", "source": name, "logicalModel": url,
               "input": {"format": "csv", "delimiter": ",", "encoding": "utf-8", "headerRow": 1},
               "onInvalidValue": "report-drop", "columns": norm_cols, "ids": ids, "hash": {"algorithm": "sha256"}},
              open(f"{out}/normalization-{name}.json", 'w'), ensure_ascii=False, indent=2)
for vm in proj['valueMaps']:
    entries = [e for e in vm['entries'] if e['action']['kind'] in ('use',)]
    systems = sorted({e['target'].get('system', '') for e in entries})
    groups = []
    for s in systems:
        els = []
        for e in entries:
            t = e['target']
            if t.get('system', '') != s: continue
            tgt = {"code": t.get('code', t.get('value')), "equivalence": "equivalent"}
            if 'display' in t: tgt['display'] = t['display']
            if 'version' in t: tgt['version'] = t['version']
            els.append({"code": e['sourceValue'], **({"display": e['sourceLabel']} if 'sourceLabel' in e else {}), "target": [tgt]})
        g = {"element": els}
        if s: g['target'] = s
        groups.append(g)
    if vm['target'] == 'code' and systems == ['']:
        pass
    cm = {"resourceType": "ConceptMap", "id": vm['name'], "url": f"{base}/ConceptMap/{vm['name']}", "version": proj['formatVersion'],
          "name": vm['name'][0].upper() + vm['name'][1:], "status": "draft", "description": vm.get('description', ''), "group": groups}
    json.dump(cm, open(f"{out}/ConceptMap-{vm['name']}.json", 'w'), ensure_ascii=False, indent=2)
print('ok', out)
