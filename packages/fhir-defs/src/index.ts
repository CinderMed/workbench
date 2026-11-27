/** FHIR R4/R5 definitions: compact index, element trees and path resolution (ADR-0013). */
export const packageName = "@cindermed/fhir-defs";

export { buildIndex, type BuiltIndex, type PackageContents } from "./build-index.js";
export { CORE_PACKAGES, type CorePackage, corePackage, findCorePackage } from "./core-packages.js";
export {
  type PathIssue,
  type PathIssueCode,
  type PathResult,
  type ReferenceTargets,
  type ResolvedElement,
  type ResolvedSegment,
  type TreeNode,
  elementTree,
  referenceTargets,
  resolvePath,
  withDefinitions,
} from "./element-tree.js";
export { FhirDefinitions, type IndexFetch, indexId } from "./definitions.js";
export {
  INDEX_FORMAT_VERSION,
  type DefinitionKind,
  type ElementBinding,
  type ElementSlicing,
  type ElementType,
  type ElementValue,
  type IndexElement,
  type IndexEntry,
  type IndexIssue,
  type IndexIssueCode,
  type IndexManifest,
  type IndexPackage,
  type PackageRef,
  type Result,
  type TypeDocument,
  type ValueSetDocument,
  type ValueSetEntry,
  elementPath,
  isSupportedFormat,
  parseManifest,
  parseTypeDocument,
  parseValueSetDocument,
} from "./index-format.js";
export { FhirCode, loadProjectDefinitions, validateFhir } from "./validate-fhir.js";
export {
  type ColumnType,
  TypeCode,
  type TypeFinding,
  type Verdict,
  castAllowed,
  checkRowTypes,
  checkValueType,
  copyVerdict,
  fhirType,
  isDerivedQuantity,
  isQuantity,
  valueMapVerdict,
  valueVerdict,
} from "./type-compat.js";
export {
  BindingCode,
  type BindingFinding,
  type WrittenCode,
  checkBinding,
  rowCodes,
  valueCodes,
} from "./binding.js";
export { MAX_VALUE_SET_CODES } from "./build-index.js";
export { ReferenceCode, checkReferences } from "./references.js";
export { CardinalityCode, checkCardinality, exclusive, requirements } from "./cardinality.js";
export { SliceNameCode, checkSliceNames, usableSliceName } from "./slice-names.js";
