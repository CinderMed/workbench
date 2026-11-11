/**
 * Deterministic printer of the FML syntax tree.
 *
 * Same tree, same text, byte for byte: 2-space indentation, `\n` line ends, no timestamps, node
 * order as in the tree (the generator fixes it from the project), map name between backticks,
 * strings between single quotes with escaping, `$this.` in front of every column, parentheses only
 * around nested `and`/`or`, no `///` metadata.
 *
 * Besides the text, the printer returns the rule each line belongs to, so that a check on the text
 * (grammar, engine) can be traced back to the mapping row named in the rule.
 */
import type {
  Expr,
  Group,
  Literal,
  Rule,
  RuleName,
  Source,
  StructureMapAst,
  Target,
  Then,
  Transform,
} from "./fml-ast.js";

/** A tree that cannot be printed as valid FML (e.g. a negative number in a transform literal). */
export class FmlPrintError extends Error {
  override readonly name = "FmlPrintError";
}

export interface PrintedMap {
  /** FML text, ending with a newline. */
  readonly text: string;
  /**
   * Innermost rule of each line: `lineRules[n - 1]` is the rule of line `n`, `null` for lines
   * outside rules (map header, `uses`, group header and closing brace, blank lines).
   */
  readonly lineRules: readonly (RuleName | null)[];
}

const ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\\\",
  "'": "\\'",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\f": "\\f",
};

/**
 * FML string between single quotes. Backslash, quote, newline, carriage return, tab and form feed
 * use the grammar's escapes; other control characters become `\uXXXX`.
 */
export function quoteString(value: string): string {
  let out = "'";
  for (const ch of value) {
    const escape = ESCAPES[ch];
    if (escape !== undefined) out += escape;
    else if (ch < " " || ch === "\u007f")
      out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `${out}'`;
}

/** Unsigned INTEGER or DECIMAL token: the only numbers the grammar accepts as a literal. */
const NUMBER_TOKEN = /^\d+(\.\d+)?$/;

/** Constant as written in FML and FHIRPath. */
export function printLiteral(value: Literal): string {
  if (typeof value === "string") return quoteString(value);
  if (typeof value === "boolean") return String(value);
  const text = String(value);
  if (!NUMBER_TOKEN.test(text)) {
    throw new FmlPrintError(`Number literal is not valid in FML: ${text}`);
  }
  return text;
}

function isControl(ch: string): boolean {
  return ch < " " || ch === "\u007f";
}

/** Map and `uses` URLs: printed between double quotes, so they never contain quotes, backslashes or spaces. */
function printUrl(url: string): string {
  if (url === "" || /[\s"\\]/.test(url) || Array.from(url).some(isControl)) {
    throw new FmlPrintError(`URL is not valid in FML: "${url}"`);
  }
  return `"${url}"`;
}

function equalities(values: readonly Literal[]): string {
  return values.map((value) => `$this = ${printLiteral(value)}`).join(" or ");
}

/** FHIRPath expression as written in the FML text. */
export function printExpr(expr: Expr): string {
  switch (expr.kind) {
    case "exists":
      return `$this.${expr.column}.exists()`;
    case "anyOf":
      return `$this.${expr.column}.where(${equalities(expr.values)}).exists()`;
    case "noneOf":
      return `$this.${expr.column}.where(${equalities(expr.values)}).empty()`;
    case "thisEquals":
      return `$this = ${printLiteral(expr.value)}`;
    case "and":
    case "or":
      return expr.args
        .map((arg) =>
          arg.kind === "and" || arg.kind === "or" ? `(${printExpr(arg)})` : printExpr(arg),
        )
        .join(` ${expr.kind} `);
    case "not":
      return `(${printExpr(expr.arg)}).not()`;
    case "prefixThis":
      return `${quoteString(expr.prefix)} + $this`;
    case "raw":
      return expr.text;
  }
}

function printTransform(transform: Transform): string {
  switch (transform.kind) {
    case "literal":
      return printLiteral(transform.value);
    case "copy":
      return transform.variable;
    case "create":
      return `create(${quoteString(transform.type)})`;
    case "c":
    case "cc": {
      const params = [transform.system, transform.code];
      if (transform.display !== undefined) params.push(transform.display);
      return `${transform.kind}(${params.map(quoteString).join(", ")})`;
    }
    case "evaluate":
      return `evaluate(${transform.variable}, ${printExpr(transform.expression)})`;
  }
}

function printSource(source: Source): string {
  return (
    source.context +
    (source.element === undefined ? "" : `.${source.element}`) +
    (source.alias === undefined ? "" : ` as ${source.alias}`) +
    (source.where === undefined ? "" : ` where (${printExpr(source.where)})`)
  );
}

function printTarget(target: Target): string {
  return (
    `${target.context}.${target.element}` +
    (target.transform === undefined ? "" : ` = ${printTransform(target.transform)}`) +
    (target.alias === undefined ? "" : ` as ${target.alias}`)
  );
}

/** Collects output lines and the rule each one belongs to. */
class Lines {
  readonly text: string[] = [];
  readonly rules: (RuleName | null)[] = [];

  push(line: string, rule: RuleName | null): void {
    this.text.push(line);
    this.rules.push(rule);
  }

  comment(comment: string | undefined, indent: string, rule: RuleName | null): void {
    if (comment === undefined || comment === "") return;
    for (const line of comment.split(/\r\n|\r|\n/)) this.push(`${indent}// ${line}`, rule);
  }
}

function printRule(rule: Rule, indent: string, out: Lines): void {
  out.comment(rule.comment, indent, rule.name);
  const head =
    indent +
    printSource(rule.source) +
    (rule.targets.length > 0 ? ` -> ${rule.targets.map(printTarget).join(", ")}` : "");
  const then: Then | undefined = rule.then;
  if (then?.kind === "rules") {
    out.push(`${head} then {`, rule.name);
    for (const child of then.rules) printRule(child, `${indent}  `, out);
    out.push(`${indent}} "${rule.name}";`, rule.name);
    return;
  }
  const invoke = then === undefined ? "" : ` then ${then.group}(${then.args.join(", ")})`;
  out.push(`${head}${invoke} "${rule.name}";`, rule.name);
}

function printGroup(group: Group, out: Lines): void {
  out.comment(group.comment, "", null);
  const params = group.params
    .map(
      (param) => `${param.mode} ${param.name}${param.type === undefined ? "" : ` : ${param.type}`}`,
    )
    .join(", ");
  out.push(`group ${group.name}(${params}) {`, null);
  for (const rule of group.rules) printRule(rule, "  ", out);
  out.push("}", null);
}

/** Prints the map and returns the text with the rule of each line. */
export function printMapWithLines(map: StructureMapAst): PrintedMap {
  const out = new Lines();
  out.push(`map ${printUrl(map.url)} = \`${map.name}\``, null);
  out.push("", null);
  for (const use of map.uses)
    out.push(`uses ${printUrl(use.url)} alias ${use.alias} as ${use.mode}`, null);
  out.push("", null);
  map.groups.forEach((group, index) => {
    if (index > 0) out.push("", null);
    printGroup(group, out);
  });
  return { text: `${out.text.join("\n")}\n`, lineRules: out.rules };
}

/** Prints the map as FML text. */
export function printMap(map: StructureMapAst): string {
  return printMapWithLines(map).text;
}

/** Rule of a 1-based line number of a printed map, or `null` when the line is outside rules or the text. */
export function ruleAtLine(printed: PrintedMap, line: number): RuleName | null {
  return printed.lineRules[line - 1] ?? null;
}
