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
export { GeneratorCode, GeneratorInputError } from "./generator/codes.js";
export {
  MAX_ELEMENT_NAME_LENGTH,
  assignElementName,
  baseElementName,
} from "./generator/element-names.js";
export {
  ELEMENT_TYPE,
  logicalModel,
  logicalModelName,
  logicalModelUrl,
  type ElementDefinitionJson,
  type LogicalModelJson,
} from "./generator/logical-model.js";
export {
  normalizationSpec,
  type NormalizationSpecOptions,
} from "./generator/normalization-spec.js";
export {
  planTable,
  roleKey,
  type Planned,
  type PlannedColumn,
  type PlannedIdField,
  type TablePlan,
} from "./generator/table-plan.js";
export { baseValueRuleName, valueRuleNames } from "./generator/rule-names.js";
