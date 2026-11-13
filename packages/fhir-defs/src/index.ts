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
  type PackageRef,
  type Result,
  type TypeDocument,
  elementPath,
  isSupportedFormat,
  parseManifest,
  parseTypeDocument,
} from "./index-format.js";
export { FhirCode, loadProjectDefinitions, validateFhir } from "./validate-fhir.js";
