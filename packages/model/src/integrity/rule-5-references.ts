// Rule 5 (structural part): the columns of the target `idRule` are reachable from the row.
// A target in the same table is always reachable (its id rule reads the same record). A target in
// another table needs a `via` relation between the two tables whose columns on the target side
// cover the target id rule. The types allowed by `targetProfile`, and the repeating source element
// required towards a `perValue` role, need the FHIR definitions: module 3 (F4, ADR-0005).
import type { ValidationResult } from "../validation-result.js";
import { IntegrityCode } from "./codes.js";
import type { Owner, ProjectIndex } from "./project-index.js";
import { error } from "./result.js";

export function checkReferences(index: ProjectIndex): ValidationResult[] {
  const results: ValidationResult[] = [];

  for (const row of index.project.mappings) {
    const transform = row.transform;
    if (transform.kind !== "reference") continue;
    const role = index.instances.get(row.instanceId);
    const target = index.instances.get(transform.targetInstanceId);
    // Missing roles are rule 1.
    if (role === undefined || target === undefined) continue;
    if (role.sourceId === target.sourceId) continue;

    const owner: Owner = { objectKind: "mapping", id: row.id };
    const label = `${target.resourceType}[${String(target.index)}]`;
    if (transform.via === undefined) {
      results.push(
        error(
          IntegrityCode.REFERENCE_NEEDS_VIA,
          owner,
          "transform.via",
          `${label} is in table '${target.sourceId}', not in '${role.sourceId}': choose the relation to use (via)`,
        ),
      );
      continue;
    }
    const relation = index.relations.get(transform.via);
    if (relation === undefined) continue;

    // The relation can be used in both directions: take the side that matches the target table.
    const targetSide =
      relation.to.sourceId === target.sourceId && relation.from.sourceId === role.sourceId
        ? relation.to
        : relation.from.sourceId === target.sourceId && relation.to.sourceId === role.sourceId
          ? relation.from
          : undefined;
    if (targetSide === undefined) {
      results.push(
        error(
          IntegrityCode.VIA_RELATION_MISMATCH,
          owner,
          "transform.via",
          `relation '${relation.id}' links '${relation.from.sourceId}' and '${relation.to.sourceId}', not '${role.sourceId}' and '${target.sourceId}'`,
        ),
      );
      continue;
    }

    const reachable = new Set(targetSide.columnIds);
    for (const part of target.idRule?.parts ?? []) {
      if (!("columnId" in part) || reachable.has(part.columnId)) continue;
      results.push(
        error(
          IntegrityCode.ID_RULE_NOT_REACHABLE,
          owner,
          "transform.via",
          `the id of ${label} uses column '${part.columnId}', which relation '${relation.id}' does not provide`,
        ),
      );
    }
  }

  return results;
}
