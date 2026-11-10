/**
 * FML tree of the MOTU HospitalStay table, built the way the generator will build it from the
 * project file. It shows that the types in fml-ast.ts are enough to express a verified map:
 * printed with fml-print.ts, the result replaces motu/HospitalStay.map and passes every check again.
 */
import { groupName as G, ident as I, ruleName as R, type StructureMapAst, type Rule, type Expr } from './fml-ast.js';
import { printMap } from './fml-print.js';

const base = 'http://example.org/fhir/motu';
const src = I('src'), res = I('res'), e = I('e'), req = I('req');

/** id + request + fullUrl rule, identical for every role. */
const idRule = (type: string, field: string, name: string): Rule => ({
  name: R(`${name}-id`),
  source: { context: src, element: I(field), alias: I('i') },
  targets: [
    { context: res, element: I('id'), transform: { kind: 'copy', variable: I('i') } },
    { context: req, element: I('method'), transform: { kind: 'literal', value: 'PUT' } },
    { context: req, element: I('url'), transform: { kind: 'evaluate', variable: I('i'), expression: { kind: 'prefixThis', prefix: `${type}/` } } },
    { context: e, element: I('fullUrl'), transform: { kind: 'evaluate', variable: I('i'), expression: { kind: 'prefixThis', prefix: `${base}/${type}/` } } },
  ],
});

/** Rule of the main group that creates a role's entry. */
const roleEntry = (type: string, idx: number, createWhen: Expr | undefined, comment: string, rowType: string): Rule => {
  const key = `${type}${idx}`, field = `id_${key}`;
  const guard: Expr = { kind: 'exists', column: I(field) };
  return {
    name: R(key), comment,
    source: { context: src, where: createWhen ? { kind: 'and', args: [guard, createWhen] } : guard },
    targets: [
      { context: I('bundle'), element: I('entry'), alias: e },
      { context: e, element: I('resource'), transform: { kind: 'create', type: I(type) }, alias: res },
      { context: e, element: I('request'), alias: req },
    ],
    then: { kind: 'rules', rules: [
      idRule(type, field, key),
      { name: R(`${key}-body`), source: { context: src }, targets: [], then: { kind: 'invoke', group: G(key), args: [src, res] } },
    ] },
  };
};

export const hospitalStay: StructureMapAst = {
  url: `${base}/StructureMap/HospitalStay`,
  name: G('HospitalStay'),
  uses: [
    { url: `${base}/StructureDefinition/HospitalStayRow`, alias: I('HospitalStayRow'), mode: 'source' },
    { url: 'http://hl7.org/fhir/StructureDefinition/Bundle', alias: I('Bundle'), mode: 'target' },
    { url: 'http://hl7.org/fhir/StructureDefinition/Encounter', alias: I('Encounter'), mode: 'produced' },
  ],
  groups: [
    {
      name: G('HospitalStay'),
      params: [{ mode: 'source', name: src, type: I('HospitalStayRow') }, { mode: 'target', name: I('bundle'), type: I('Bundle') }],
      rules: [
        { name: R('bundle-type'), source: { context: src }, targets: [{ context: I('bundle'), element: I('type'), transform: { kind: 'literal', value: 'transaction' } }] },
        roleEntry('Encounter', 0, { kind: 'exists', column: I('AdmissionDate') }, 'Encounter[0] · hospital stay — created when: AdmissionDate is not empty', 'HospitalStayRow'),
      ],
    },
    {
      name: G('Encounter0'),
      params: [{ mode: 'source', name: src, type: I('HospitalStayRow') }, { mode: 'target', name: res, type: I('Encounter') }],
      rules: [
        { name: R('fixed-status'), source: { context: src }, targets: [{ context: res, element: I('status'), transform: { kind: 'literal', value: 'finished' } }] },
        { name: R('fixed-class'), source: { context: src }, targets: [{ context: res, element: I('class'),
          transform: { kind: 'c', system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP', display: 'inpatient encounter' } }] },
        {
          name: R('Encounter0-period'),
          comment: 'period: non-repeating element written by two rows (R-004, R-005) → one shared instance',
          source: { context: src, where: { kind: 'or', args: [{ kind: 'exists', column: I('AdmissionDate') }, { kind: 'exists', column: I('DischargeDate') }] } },
          targets: [{ context: res, element: I('period'), alias: I('p') }],
          then: { kind: 'rules', rules: [
            { name: R('R-004'), source: { context: src, element: I('AdmissionDate'), alias: I('v') }, targets: [{ context: I('p'), element: I('start'), transform: { kind: 'copy', variable: I('v') } }] },
            { name: R('R-005'), source: { context: src, element: I('DischargeDate'), alias: I('v') }, targets: [{ context: I('p'), element: I('end'), transform: { kind: 'copy', variable: I('v') } }] },
          ] },
        },
        {
          name: R('R-006'),
          comment: 'R-006 reference to Patient[0] in another table (via rel_stay_patient): the resource must already be loaded',
          source: { context: src, element: I('id_Patient0'), alias: I('t') },
          targets: [
            { context: res, element: I('subject'), alias: I('r') },
            { context: I('r'), element: I('reference'), transform: { kind: 'evaluate', variable: I('t'), expression: { kind: 'prefixThis', prefix: 'Patient/' } } },
          ],
        },
      ],
    },
  ],
};

declare const process: { stdout: { write(s: string): void } };
process.stdout.write(printMap(hospitalStay));
