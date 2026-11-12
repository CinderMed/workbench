/**
 * StructureMap resource (JSON) built from the FML syntax tree.
 *
 * The package manifest lists, for every table, the StructureMap both as FML text and as JSON. The
 * export runs without Java, so the JSON is built here, in the form the HL7 engine
 * (org.hl7.fhir.core 7.0.5) produces when it compiles the printed text (fixtures/fml-examples/
 * *\/StructureMap-*.json):
 *
 * - `id` and `name` are the map name; no metadata, as in the compiled output, except `status`,
 *   which FHIR requires and the compiled output lacks: always `draft` (ADR-0007 addendum);
 * - the narrative is the FML text, XML-escaped inside `<pre>`, with code points above U+FFFF as
 *   numeric references, as the engine writes them;
 * - constants become a `copy` transform with a `value[x]` parameter, variables `valueId`;
 * - `where` conditions are FHIRPath rendered the way the HL7 engine renders a parsed expression:
 *   the clause keeps its outer parentheses, and the operands of a chain that mixes `=` with
 *   `and`/`or` are grouped (`($this = '1') or ($this = '2')`).
 *
 * R4 matches the verified fixtures. R5 drops `contextType` and `typeMode` and passes the arguments
 * of a dependent rule as `parameter` (FHIR R5 StructureMap); it is not yet checked against the HL7
 * engine, because the verified examples are R4 only.
 */
import type {
  Expr,
  Group,
  Literal,
  Rule,
  Source,
  StructureMapAst,
  Target,
  Transform,
} from "./fml-ast.js";
import { printLiteral, printMap, quoteString } from "./fml-print.js";

export type StructureMapFhirRelease = "R4" | "R5";

export type StructureMapParameter =
  | { readonly valueId: string }
  | { readonly valueString: string }
  | { readonly valueBoolean: boolean }
  | { readonly valueInteger: number }
  | { readonly valueDecimal: number };

export interface StructureMapSourceJson {
  readonly context: string;
  readonly element?: string;
  readonly variable?: string;
  readonly condition?: string;
}

export interface StructureMapTargetJson {
  readonly context: string;
  /** R4 only. */
  readonly contextType?: "variable";
  readonly element: string;
  readonly variable?: string;
  readonly transform?: "copy" | "create" | "c" | "cc" | "evaluate";
  readonly parameter?: readonly StructureMapParameter[];
}

export type StructureMapDependentJson =
  | { readonly name: string; readonly variable: readonly string[] }
  | { readonly name: string; readonly parameter: readonly { readonly valueId: string }[] };

export interface StructureMapRuleJson {
  readonly name: string;
  readonly source: readonly StructureMapSourceJson[];
  readonly target?: readonly StructureMapTargetJson[];
  readonly rule?: readonly StructureMapRuleJson[];
  readonly dependent?: readonly StructureMapDependentJson[];
}

export interface StructureMapGroupJson {
  readonly name: string;
  /** R4 only. */
  readonly typeMode?: "none";
  readonly input: readonly {
    readonly name: string;
    readonly type?: string;
    readonly mode: "source" | "target";
  }[];
  readonly rule: readonly StructureMapRuleJson[];
}

export interface StructureMapJson {
  readonly resourceType: "StructureMap";
  readonly id: string;
  readonly text: { readonly status: "additional"; readonly div: string };
  readonly url: string;
  readonly name: string;
  /** Required by FHIR; absent from the HL7 engine's output (ADR-0007 addendum). */
  readonly status: "draft";
  readonly structure: readonly {
    readonly url: string;
    readonly mode: string;
    readonly alias: string;
  }[];
  readonly group: readonly StructureMapGroupJson[];
}

export interface StructureMapOptions {
  readonly fhirRelease: StructureMapFhirRelease;
}

// ---------------------------------------------------------------- FHIRPath as rendered by the HL7 engine

function isChain(expr: Expr): boolean {
  return expr.kind === "and" || expr.kind === "or";
}

function renderEqualities(values: readonly Literal[]): string {
  const equalities = values.map((value) => `$this = ${printLiteral(value)}`);
  return equalities.length === 1
    ? (equalities[0] ?? "")
    : equalities.map((e) => `(${e})`).join(" or ");
}

/**
 * FHIRPath of a condition or an `evaluate` parameter, as the HL7 engine writes it after parsing
 * the printed text. Expert expressions (`raw`) are kept as written: the engine may format them
 * differently.
 */
export function renderFhirPath(expr: Expr): string {
  switch (expr.kind) {
    case "exists":
      return `$this.${expr.column}.exists()`;
    case "anyOf":
      return `$this.${expr.column}.where(${renderEqualities(expr.values)}).exists()`;
    case "noneOf":
      return `$this.${expr.column}.where(${renderEqualities(expr.values)}).empty()`;
    case "thisEquals":
      return `$this = ${printLiteral(expr.value)}`;
    case "and":
    case "or":
      // Nested chains are parenthesized in the text; an equality next to and/or is grouped by
      // the engine's precedence handling.
      return expr.args
        .map((arg) =>
          isChain(arg) || arg.kind === "thisEquals"
            ? `(${renderFhirPath(arg)})`
            : renderFhirPath(arg),
        )
        .join(` ${expr.kind} `);
    case "not":
      return `(${renderFhirPath(expr.arg)}).not()`;
    case "prefixThis":
      return `${quoteString(expr.prefix)} + $this`;
    case "raw":
      return expr.text;
  }
}

// ---------------------------------------------------------------- resource

function literalParameter(value: Literal): StructureMapParameter {
  if (typeof value === "string") return { valueString: value };
  if (typeof value === "boolean") return { valueBoolean: value };
  printLiteral(value); // rejects numbers the grammar does not accept
  return Number.isInteger(value) ? { valueInteger: value } : { valueDecimal: value };
}

function transformJson(
  transform: Transform,
): Pick<StructureMapTargetJson, "transform" | "parameter"> {
  switch (transform.kind) {
    case "literal":
      return { transform: "copy", parameter: [literalParameter(transform.value)] };
    case "copy":
      return { transform: "copy", parameter: [{ valueId: transform.variable }] };
    case "create":
      return { transform: "create", parameter: [{ valueString: transform.type }] };
    case "c":
    case "cc": {
      const values = [transform.system, transform.code];
      if (transform.display !== undefined) values.push(transform.display);
      return {
        transform: transform.kind,
        parameter: values.map((valueString) => ({ valueString })),
      };
    }
    case "evaluate":
      return {
        transform: "evaluate",
        parameter: [
          { valueId: transform.variable },
          { valueString: renderFhirPath(transform.expression) },
        ],
      };
  }
}

function sourceJson(source: Source): StructureMapSourceJson {
  return {
    context: source.context,
    ...(source.element === undefined ? {} : { element: source.element }),
    ...(source.alias === undefined ? {} : { variable: source.alias }),
    ...(source.where === undefined ? {} : { condition: `(${renderFhirPath(source.where)})` }),
  };
}

function targetJson(target: Target, release: StructureMapFhirRelease): StructureMapTargetJson {
  return {
    context: target.context,
    ...(release === "R4" ? { contextType: "variable" as const } : {}),
    element: target.element,
    ...(target.alias === undefined ? {} : { variable: target.alias }),
    ...(target.transform === undefined ? {} : transformJson(target.transform)),
  };
}

function ruleJson(rule: Rule, release: StructureMapFhirRelease): StructureMapRuleJson {
  const then = rule.then;
  let nested: Pick<StructureMapRuleJson, "rule" | "dependent"> = {};
  if (then?.kind === "rules") {
    nested = { rule: then.rules.map((child) => ruleJson(child, release)) };
  } else if (then?.kind === "invoke") {
    const dependent: StructureMapDependentJson =
      release === "R4"
        ? { name: then.group, variable: [...then.args] }
        : { name: then.group, parameter: then.args.map((valueId) => ({ valueId })) };
    nested = { dependent: [dependent] };
  }
  return {
    name: rule.name,
    source: [sourceJson(rule.source)],
    ...(rule.targets.length === 0
      ? {}
      : { target: rule.targets.map((t) => targetJson(t, release)) }),
    ...nested,
  };
}

function groupJson(group: Group, release: StructureMapFhirRelease): StructureMapGroupJson {
  return {
    name: group.name,
    ...(release === "R4" ? { typeMode: "none" as const } : {}),
    input: group.params.map((param) => ({
      name: param.name,
      ...(param.type === undefined ? {} : { type: param.type }),
      mode: param.mode,
    })),
    rule: group.rules.map((rule) => ruleJson(rule, release)),
  };
}

/**
 * The narrative text as the HL7 engine writes it: the four XML markup characters as entities, and
 * code points above U+FFFF (emoji, for example) as numeric references in upper-case hexadecimal
 * (`&#x1F600;`). Everything else, accented letters included, stays as it is (#135).
 */
function escapeXml(text: string): string {
  return text.replace(/[&<>"]|[\u{10000}-\u{10FFFF}]/gu, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return `&#x${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase()};`;
  });
}

/** StructureMap resource for the map, equivalent to what the HL7 engine compiles from its printed text. */
export function toStructureMap(
  map: StructureMapAst,
  options: StructureMapOptions,
): StructureMapJson {
  const release = options.fhirRelease;
  const text = printMap(map);
  return {
    resourceType: "StructureMap",
    id: map.name,
    text: {
      status: "additional",
      div: `<div xmlns="http://www.w3.org/1999/xhtml"><pre>${escapeXml(text)}</pre></div>`,
    },
    url: map.url,
    name: map.name,
    status: "draft",
    structure: map.uses.map((use) => ({ url: use.url, mode: use.mode, alias: use.alias })),
    group: map.groups.map((group) => groupJson(group, release)),
  };
}
