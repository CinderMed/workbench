/**
 * FML tree of the MOTU HospitalStay table (port of fixtures/fml-examples/generator/
 * example-hospitalstay.ts), built the way the generator builds it from the project file.
 * Printed, it is byte-identical to fixtures/fml-examples/motu/HospitalStay.map.
 */
import {
  groupName,
  ident,
  ruleName,
  type Expr,
  type Rule,
  type StructureMapAst,
} from "../fml-ast.js";

const base = "http://example.org/fhir/motu";
const src = ident("src");
const res = ident("res");
const e = ident("e");
const req = ident("req");

/** id + request + fullUrl rule, identical for every role. */
function idRule(type: string, field: string, key: string): Rule {
  return {
    name: ruleName(`${key}-id`),
    source: { context: src, element: ident(field), alias: ident("i") },
    targets: [
      { context: res, element: ident("id"), transform: { kind: "copy", variable: ident("i") } },
      { context: req, element: ident("method"), transform: { kind: "literal", value: "PUT" } },
      {
        context: req,
        element: ident("url"),
        transform: {
          kind: "evaluate",
          variable: ident("i"),
          expression: { kind: "prefixThis", prefix: `${type}/` },
        },
      },
      {
        context: e,
        element: ident("fullUrl"),
        transform: {
          kind: "evaluate",
          variable: ident("i"),
          expression: { kind: "prefixThis", prefix: `${base}/${type}/` },
        },
      },
    ],
  };
}

/** Rule of the main group that creates a role's entry. */
function roleEntry(type: string, index: number, createWhen: Expr, comment: string): Rule {
  const key = `${type}${String(index)}`;
  const field = `id_${key}`;
  return {
    name: ruleName(key),
    comment,
    source: {
      context: src,
      where: { kind: "and", args: [{ kind: "exists", column: ident(field) }, createWhen] },
    },
    targets: [
      { context: ident("bundle"), element: ident("entry"), alias: e },
      {
        context: e,
        element: ident("resource"),
        transform: { kind: "create", type: ident(type) },
        alias: res,
      },
      { context: e, element: ident("request"), alias: req },
    ],
    then: {
      kind: "rules",
      rules: [
        idRule(type, field, key),
        {
          name: ruleName(`${key}-body`),
          source: { context: src },
          targets: [],
          then: { kind: "invoke", group: groupName(key), args: [src, res] },
        },
      ],
    },
  };
}

export const hospitalStay: StructureMapAst = {
  url: `${base}/StructureMap/HospitalStay`,
  name: groupName("HospitalStay"),
  uses: [
    {
      url: `${base}/StructureDefinition/HospitalStayRow`,
      alias: ident("HospitalStayRow"),
      mode: "source",
    },
    {
      url: "http://hl7.org/fhir/StructureDefinition/Bundle",
      alias: ident("Bundle"),
      mode: "target",
    },
    {
      url: "http://hl7.org/fhir/StructureDefinition/Encounter",
      alias: ident("Encounter"),
      mode: "target",
    },
  ],
  groups: [
    {
      name: groupName("HospitalStay"),
      params: [
        { mode: "source", name: src, type: ident("HospitalStayRow") },
        { mode: "target", name: ident("bundle"), type: ident("Bundle") },
      ],
      rules: [
        {
          name: ruleName("bundle-type"),
          source: { context: src },
          targets: [
            {
              context: ident("bundle"),
              element: ident("type"),
              transform: { kind: "literal", value: "transaction" },
            },
          ],
        },
        roleEntry(
          "Encounter",
          0,
          { kind: "exists", column: ident("AdmissionDate") },
          "Encounter[0] · hospital stay — created when: AdmissionDate is not empty",
        ),
      ],
    },
    {
      name: groupName("Encounter0"),
      params: [
        { mode: "source", name: src, type: ident("HospitalStayRow") },
        { mode: "target", name: res, type: ident("Encounter") },
      ],
      rules: [
        {
          name: ruleName("fixed-status"),
          source: { context: src },
          targets: [
            {
              context: res,
              element: ident("status"),
              transform: { kind: "literal", value: "finished" },
            },
          ],
        },
        {
          name: ruleName("fixed-class"),
          source: { context: src },
          targets: [
            {
              context: res,
              element: ident("class"),
              transform: {
                kind: "c",
                system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                code: "IMP",
                display: "inpatient encounter",
              },
            },
          ],
        },
        {
          name: ruleName("Encounter0-period"),
          comment:
            "period: non-repeating element written by two rows (R-004, R-005) → one shared instance",
          source: {
            context: src,
            where: {
              kind: "or",
              args: [
                { kind: "exists", column: ident("AdmissionDate") },
                { kind: "exists", column: ident("DischargeDate") },
              ],
            },
          },
          targets: [{ context: res, element: ident("period"), alias: ident("p") }],
          then: {
            kind: "rules",
            rules: [
              {
                name: ruleName("R-004"),
                source: { context: src, element: ident("AdmissionDate"), alias: ident("v") },
                targets: [
                  {
                    context: ident("p"),
                    element: ident("start"),
                    transform: { kind: "copy", variable: ident("v") },
                  },
                ],
              },
              {
                name: ruleName("R-005"),
                source: { context: src, element: ident("DischargeDate"), alias: ident("v") },
                targets: [
                  {
                    context: ident("p"),
                    element: ident("end"),
                    transform: { kind: "copy", variable: ident("v") },
                  },
                ],
              },
            ],
          },
        },
        {
          name: ruleName("R-006"),
          comment:
            "R-006 reference to Patient[0] in another table (via rel_stay_patient): the resource must already be loaded",
          source: { context: src, element: ident("id_Patient0"), alias: ident("t") },
          targets: [
            { context: res, element: ident("subject"), alias: ident("r") },
            {
              context: ident("r"),
              element: ident("reference"),
              transform: {
                kind: "evaluate",
                variable: ident("t"),
                expression: { kind: "prefixThis", prefix: "Patient/" },
              },
            },
          ],
        },
      ],
    },
  ],
};
