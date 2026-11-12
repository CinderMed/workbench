/**
 * FML tree of the golden case fixtures/fml-examples/boolean-value-map (Visit table), built with
 * the syntax tree as the generator will build it, never written by hand. Printed, it is
 * fixtures/fml-examples/boolean-value-map/Visit.map; the HL7 engine compiled that text into
 * StructureMap-Visit.json and ran it on the test rows.
 *
 * What it covers: an Italian yes/no column (`Sì`/`No`) is categorical, and the value map `siNo`
 * (target boolean) becomes one rule per value with a boolean constant on Observation.value.
 * Rule names of value-map rules follow `valueRuleNames` (`Sì` → `R-002-S_`, `No` → `R-002-No`).
 */
import {
  groupName,
  ident,
  ruleName,
  type Expr,
  type RuleName,
  type Rule,
  type StructureMapAst,
} from "../fml-ast.js";
import { valueRuleNames } from "../generator/rule-names.js";

const base = "http://example.org/fhir/boolean-value-map";
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

/** Rule of the main group that creates a role's entry: always guarded by the presence of its id. */
function roleEntry(
  type: string,
  index: number,
  createWhen: Expr | undefined,
  comment: string,
): Rule {
  const key = `${type}${String(index)}`;
  const field = `id_${key}`;
  const idExists: Expr = { kind: "exists", column: ident(field) };
  return {
    name: ruleName(key),
    comment,
    source: {
      context: src,
      where: createWhen === undefined ? idExists : { kind: "and", args: [idExists, createWhen] },
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

/** One value-map rule: `src.col as v where ($this = 'value') -> res.value = <boolean>`. */
function booleanValueRule(name: RuleName, value: string, result: boolean): Rule {
  return {
    name,
    source: {
      context: src,
      element: ident("fumatore"),
      alias: ident("v"),
      where: { kind: "thisEquals", value },
    },
    targets: [
      { context: res, element: ident("value"), transform: { kind: "literal", value: result } },
    ],
  };
}

const rowType = ident("VisitRow");
const [siName, noName] = valueRuleNames("R-002", ["Sì", "No"]) as [RuleName, RuleName];

export const booleanValueMap: StructureMapAst = {
  url: `${base}/StructureMap/Visit`,
  name: groupName("Visit"),
  uses: [
    { url: `${base}/StructureDefinition/VisitRow`, alias: rowType, mode: "source" },
    {
      url: "http://hl7.org/fhir/StructureDefinition/Bundle",
      alias: ident("Bundle"),
      mode: "target",
    },
    {
      url: "http://hl7.org/fhir/StructureDefinition/Patient",
      alias: ident("Patient"),
      mode: "target",
    },
    {
      url: "http://hl7.org/fhir/StructureDefinition/Observation",
      alias: ident("Observation"),
      mode: "target",
    },
  ],
  groups: [
    {
      name: groupName("Visit"),
      comment:
        "Main group: one transaction Bundle per normalized record.\nEach role becomes an entry with PUT on its deterministic id (computed by the normalization).",
      params: [
        { mode: "source", name: src, type: rowType },
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
        roleEntry("Patient", 0, undefined, "Patient[0] · patient — always"),
        roleEntry(
          "Observation",
          0,
          { kind: "exists", column: ident("fumatore") },
          "Observation[0] · smoker — created when: fumatore is not empty",
        ),
      ],
    },
    {
      name: groupName("Patient0"),
      params: [
        { mode: "source", name: src, type: rowType },
        { mode: "target", name: res, type: ident("Patient") },
      ],
      rules: [
        {
          name: ruleName("Patient0-identifier"),
          comment: "identifier: repeating element without a slice → one shared repetition",
          source: { context: src, where: { kind: "exists", column: ident("patient_id") } },
          targets: [{ context: res, element: ident("identifier"), alias: ident("rep") }],
          then: {
            kind: "rules",
            rules: [
              {
                name: ruleName("R-001"),
                source: { context: src, element: ident("patient_id"), alias: ident("v") },
                targets: [
                  {
                    context: ident("rep"),
                    element: ident("value"),
                    transform: { kind: "copy", variable: ident("v") },
                  },
                ],
              },
            ],
          },
        },
      ],
    },
    {
      name: groupName("Observation0"),
      params: [
        { mode: "source", name: src, type: rowType },
        { mode: "target", name: res, type: ident("Observation") },
      ],
      rules: [
        {
          name: ruleName("fixed-status"),
          source: { context: src },
          targets: [
            {
              context: res,
              element: ident("status"),
              transform: { kind: "literal", value: "final" },
            },
          ],
        },
        {
          name: ruleName("fixed-code"),
          source: { context: src },
          targets: [
            {
              context: res,
              element: ident("code"),
              transform: {
                kind: "cc",
                system: "http://snomed.info/sct",
                code: "77176002",
                display: "Smoker",
              },
            },
          ],
        },
        {
          ...booleanValueRule(siName, "Sì", true),
          comment:
            "R-002: value map siNo to boolean (one rule per value; ConceptMap exported separately)",
        },
        booleanValueRule(noName, "No", false),
        {
          name: ruleName("R-003"),
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
