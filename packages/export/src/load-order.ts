/**
 * Load order of the tables (specification, "Manifest and load order"): a table depends on another
 * when one of its rows uses a `via` relation towards it, because the referenced resources must
 * already be on the server. The order is a topological sort by levels, alphabetical on ties; a
 * cycle between tables blocks the export.
 */
import type { ProjectFile } from "@cindermed/model";

export interface LoadOrder {
  /** Table name → names of the tables it depends on, sorted. */
  readonly dependsOn: ReadonlyMap<string, readonly string[]>;
  /** Levels of table names; absent when a cycle leaves tables unordered (`cycle`: those tables). */
  readonly levels?: readonly (readonly string[])[];
  readonly cycle?: readonly string[];
}

export function loadOrder(project: ProjectFile): LoadOrder {
  const names = new Map(project.sources.map((s) => [s.id, s.name]));
  const instances = new Map(project.instances.map((i) => [i.id, i]));
  const relations = new Map((project.sourceRelations ?? []).map((r) => [r.id, r]));
  const deps = new Map<string, Set<string>>(project.sources.map((s) => [s.name, new Set()]));
  for (const row of project.mappings) {
    const transform = row.transform;
    if (transform.kind !== "reference" || transform.via === undefined) continue;
    const relation = relations.get(transform.via);
    const from = names.get(instances.get(row.instanceId)?.sourceId ?? "");
    const to = names.get(relation?.to.sourceId ?? "");
    if (from !== undefined && to !== undefined && from !== to) deps.get(from)?.add(to);
  }
  const dependsOn = new Map([...deps].map(([name, set]) => [name, [...set].sort()]));
  const levels: string[][] = [];
  const done = new Set<string>();
  while (done.size < deps.size) {
    const level = [...deps]
      .filter(([name, set]) => !done.has(name) && [...set].every((d) => done.has(d)))
      .map(([name]) => name)
      .sort();
    if (level.length === 0) {
      return { dependsOn, cycle: [...deps.keys()].filter((n) => !done.has(n)).sort() };
    }
    levels.push(level);
    for (const name of level) done.add(name);
  }
  return { dependsOn, levels };
}
