"""Generates manifest.json for an example folder (prototype of the G7 export step).
Usage: python3 manifest.py <project.json> <folder> <grammar_commit> <validator_version>"""
import json, sys, os, hashlib, glob, datetime

proj = json.load(open(sys.argv[1])); folder = sys.argv[2]
p = proj['project']; base = p['canonicalBase']
srcname = {s['id']: s['name'] for s in proj['sources']}

# dependencies: a relation's 'from' table depends on its 'to' table IF one of its rows uses the relation as 'via'
deps = {s['name']: set() for s in proj['sources']}
rels = {r['id']: r for r in proj.get('sourceRelations', [])}
for m in proj['mappings']:
    t = m['transform']
    if t['kind'] == 'reference' and t.get('via'):
        r = rels[t['via']]
        deps[srcname[r['from']['sourceId']]].add(srcname[r['to']['sourceId']])
# topological sort by levels (Kahn), alphabetical on ties
order, done = [], set()
while len(done) < len(deps):
    level = sorted(n for n, d in deps.items() if n not in done and d <= done)
    if not level: raise SystemExit(f"cycle between tables: {sorted(set(deps) - done)}")
    order.append(level); done |= set(level)

def sha(path): return hashlib.sha256(open(os.path.join(folder, path), 'rb').read()).hexdigest()
tables = []
for s in proj['sources']:
    n = s['name']
    tables.append({
        "source": n, "dependsOn": sorted(deps[n]),
        "structureMap": {"url": f"{base}/StructureMap/{n}", "fml": f"{n}.map", "json": f"StructureMap-{n}.json"},
        "logicalModel": {"url": f"{base}/StructureDefinition/{n}Row", "file": f"StructureDefinition-{n}Row.json"},
        "normalization": f"normalization-{n}.json",
        "creates": [f"{i['resourceType']}[{i['index']}] · {i.get('label', '')}" for i in proj['instances'] if i['sourceId'] == s['id']]})
cms = [{"url": json.load(open(f))['url'], "file": os.path.basename(f)} for f in sorted(glob.glob(f"{folder}/ConceptMap-*.json"))]
listed = ['project.json'] + [x for t in tables for x in (t['structureMap']['fml'], t['structureMap']['json'], t['logicalModel']['file'], t['normalization'])] + [c['file'] for c in cms]
mt = lambda f: 'text/fhir-mapping' if f.endswith('.map') else 'application/fhir+json' if os.path.basename(f).split('-')[0] in ('StructureMap', 'StructureDefinition', 'ConceptMap') else 'application/json'
manifest = {
    "$schema": "../manifest.schema.json", "formatVersion": "1.0.0",
    "package": {"name": f"{p['name'].lower()}-mapping", "version": "0.1.0",
                "createdAt": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z'),
                "generator": {"name": "cindermed (verification prototype)", "version": "0.0.1"}},
    "project": {"id": p['id'], "name": p['name'], "formatVersion": proj['formatVersion'], "file": "project.json"},
    "fhirVersion": p['fhirVersion'],
    "packages": [{"name": "hl7.fhir.r4.core" if p['fhirVersion'] == '4.0.1' else "hl7.fhir.r5.core", "version": p['fhirVersion']}] + p.get('packages', []),
    "output": {"bundleType": "transaction", "requestMethod": "PUT", "fullUrlBase": p.get('output', {}).get('fullUrlBase', base)},
    "loadOrder": order, "tables": tables, "conceptMaps": cms,
    "verification": {"grammar": {"source": "HL7/mapping-language-ig input/images/mapping.g4", "commit": sys.argv[3], "result": "passed"},
                     "compile": {"engine": "HL7 validator (org.hl7.fhir.core)", "version": sys.argv[4], "result": "passed"}},
    "files": [{"path": f, "sha256": sha(f), "mediaType": mt(f)} for f in listed]}
json.dump(manifest, open(f"{folder}/manifest.json", 'w'), ensure_ascii=False, indent=2)
print(folder, 'loadOrder =', order)
