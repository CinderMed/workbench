/**
 * Defaults of the minimal role editor (#174): the next free index of a resource type, and a
 * default id rule from the table's row key. The rest of a role (multiplicity, context, conditions,
 * slices, fixed values) is module 6.
 */
import type { Instance, ProjectFile } from "@cindermed/model";

type IdRule = NonNullable<Instance["idRule"]>;

/** The next index of a resource type: one more than the highest, or 0. */
export function nextIndex(project: ProjectFile, resourceType: string, except?: string): number {
  const used = project.instances
    .filter((i) => i.resourceType === resourceType && i.id !== except)
    .map((i) => i.index);
  return used.length === 0 ? 0 : Math.max(...used) + 1;
}

/**
 * The default id rule of a role: a literal naming the role (`observation1`), so two roles of the
 * same table get different ids, then the table's row key columns. `undefined` when the table has
 * no row key (a project from `cindermed init`): the id rule is set with the row key, later.
 */
export function defaultIdRule(
  project: ProjectFile,
  sourceId: string,
  resourceType: string,
  index: number,
): IdRule | undefined {
  const rowKey = project.sources.find((s) => s.id === sourceId)?.rowKey ?? [];
  if (rowKey.length === 0) return undefined;
  return {
    parts: [
      { literal: `${resourceType.toLowerCase()}${String(index)}` },
      ...rowKey.map((columnId) => ({ columnId })),
    ],
  };
}

/** The mapping rows that write to a role or reference it. */
export function rowsUsing(project: ProjectFile, roleId: string): number {
  return project.mappings.filter(
    (m) =>
      m.instanceId === roleId ||
      (m.transform.kind === "reference" && m.transform.targetInstanceId === roleId),
  ).length;
}

/** The id rule as text, for display: `observation1-<patient_id>`. */
export function describeIdRule(project: ProjectFile, rule: IdRule | undefined): string | undefined {
  if (rule === undefined) return undefined;
  const columns = new Map(project.sources.flatMap((s) => s.columns.map((c) => [c.id, c.name])));
  return rule.parts
    .map((part) =>
      "literal" in part ? part.literal : `<${columns.get(part.columnId) ?? part.columnId}>`,
    )
    .join(rule.separator ?? "-");
}
