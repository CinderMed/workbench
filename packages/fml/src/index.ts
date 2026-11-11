/**
 * FML syntax tree, printer and project-to-FML generator.
 *
 * The grammar check lives in the `@cindermed/fml/grammar` subpath, so that importing the printer
 * or the types never pulls in the generated parser and the antlr4ng runtime (ADR-0008).
 */
export {
  FmlNameError,
  RESERVED_WORDS,
  groupName,
  ident,
  ruleName,
  type Expr,
  type Group,
  type GroupName,
  type Identifier,
  type Literal,
  type Param,
  type Rule,
  type RuleName,
  type Source,
  type StructureMapAst,
  type Target,
  type Then,
  type Transform,
  type Use,
  type UseMode,
} from "./fml-ast.js";
export {
  FmlPrintError,
  printExpr,
  printLiteral,
  printMap,
  printMapWithLines,
  quoteString,
  ruleAtLine,
  type PrintedMap,
} from "./fml-print.js";
export {
  renderFhirPath,
  toStructureMap,
  type StructureMapDependentJson,
  type StructureMapFhirRelease,
  type StructureMapGroupJson,
  type StructureMapJson,
  type StructureMapOptions,
  type StructureMapParameter,
  type StructureMapRuleJson,
  type StructureMapSourceJson,
  type StructureMapTargetJson,
} from "./structure-map.js";
