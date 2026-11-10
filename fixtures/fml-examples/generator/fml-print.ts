/**
 * Deterministic printer of the FML tree (reference prototype).
 * Same tree → same text, byte for byte: 2-space indentation, '\n', no timestamps,
 * node order = order in the tree (the generator fixes it from the project).
 */
import type { StructureMapAst, Group, Rule, Source, Target, Transform, Then, Expr, Literal } from './fml-ast.js';

/** FML string between single quotes: backslashes are doubled and the quote is escaped. */
export const str = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n')}'`;
const lit = (v: Literal): string => (typeof v === 'string' ? str(v) : String(v));
const comment = (c: string, ind: string) => c.split('\n').map(l => `${ind}// ${l}`).join('\n') + '\n';

export function printExpr(e: Expr): string {
  const eqs = (vals: Literal[]) => vals.map(v => `$this = ${lit(v)}`).join(' or ');
  switch (e.kind) {
    case 'exists': return `$this.${e.column}.exists()`;
    case 'anyOf': return `$this.${e.column}.where(${eqs(e.values)}).exists()`;
    case 'noneOf': return `$this.${e.column}.where(${eqs(e.values)}).empty()`;
    case 'thisEquals': return `$this = ${lit(e.value)}`;
    case 'and': case 'or':
      return e.args.map(a => (a.kind === 'and' || a.kind === 'or' ? `(${printExpr(a)})` : printExpr(a))).join(` ${e.kind} `);
    case 'not': return `(${printExpr(e.arg)}).not()`;
    case 'prefixThis': return `${str(e.prefix)} + $this`;
    case 'raw': return e.text;
  }
}

function printTransform(t: Transform): string {
  switch (t.kind) {
    case 'literal': return lit(t.value);
    case 'copy': return t.variable;
    case 'create': return `create(${str(t.type)})`;
    case 'c': case 'cc':
      return `${t.kind}(${[t.system, t.code, ...(t.display !== undefined ? [t.display] : [])].map(str).join(', ')})`;
    case 'evaluate': return `evaluate(${t.variable}, ${printExpr(t.expression)})`;
  }
}

function printSource(s: Source): string {
  return `${s.context}${s.element ? '.' + s.element : ''}${s.alias ? ' as ' + s.alias : ''}${s.where ? ` where (${printExpr(s.where)})` : ''}`;
}
function printTarget(t: Target): string {
  return `${t.context}.${t.element}${t.transform ? ' = ' + printTransform(t.transform) : ''}${t.alias ? ' as ' + t.alias : ''}`;
}
function printThen(t: Then, ind: string): string {
  if (t.kind === 'invoke') return ` then ${t.group}(${t.args.join(', ')})`;
  return ` then {\n${t.rules.map(r => printRule(r, ind + '  ')).join('')}${ind}}`;
}
export function printRule(r: Rule, ind: string): string {
  return (r.comment ? comment(r.comment, ind) : '') + ind + printSource(r.source)
    + (r.targets.length ? ' -> ' + r.targets.map(printTarget).join(', ') : '')
    + (r.then ? printThen(r.then, ind) : '') + ` "${r.name}";\n`;
}
function printGroup(g: Group): string {
  const params = g.params.map(p => `${p.mode} ${p.name}${p.type ? ' : ' + p.type : ''}`).join(', ');
  return (g.comment ? comment(g.comment, '') : '') + `group ${g.name}(${params}) {\n${g.rules.map(r => printRule(r, '  ')).join('')}}\n`;
}
export function printMap(m: StructureMapAst): string {
  const head = `map "${m.url}" = \`${m.name}\`\n\n` + m.uses.map(u => `uses "${u.url}" alias ${u.alias} as ${u.mode}\n`).join('');
  return head + '\n' + m.groups.map(printGroup).join('\n');
}
