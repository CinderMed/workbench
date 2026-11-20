/**
 * Groups of the mapping grid (D2): the rows of a table grouped by source section or by target
 * role, each group under a header line that can be collapsed. Pure: the grid virtualizes the lines
 * this gives, headers and rows alike.
 */
import type { ProjectFile, Source } from "@cindermed/model";
import { type GridRow, roleName } from "./rows";

export type Grouping = "section" | "role";

export type Line =
  | {
      readonly kind: "group";
      readonly key: string;
      /** The group's name, or undefined for the group of rows without a section / role. */
      readonly label?: string;
      readonly count: number;
      readonly collapsed: boolean;
    }
  | { readonly kind: "row"; readonly key: string; readonly row: GridRow };

const NONE = "none";

/** The groups in order, each with its rows. */
function groups(
  project: ProjectFile,
  source: Source,
  rows: readonly GridRow[],
  by: Grouping,
): { id: string; label?: string; rows: GridRow[] }[] {
  const order: { id: string; label?: string }[] =
    by === "section"
      ? [...(source.sections ?? [])]
          .map((s, i) => ({ s, i }))
          .sort((a, b) => (a.s.order ?? a.i) - (b.s.order ?? b.i) || a.i - b.i)
          .map(({ s }) => ({ id: s.id, label: s.name }))
      : project.instances.map((r) => ({ id: r.id, label: roleName(r) }));
  const known = new Set(order.map((g) => g.id));
  const keyOf = (row: GridRow): string => {
    const id = by === "section" ? row.column?.sectionId : (row.mapping?.instanceId ?? undefined);
    return id !== undefined && known.has(id) ? id : NONE;
  };
  const members = new Map<string, GridRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    members.set(key, [...(members.get(key) ?? []), row]);
  }
  return [...order, { id: NONE }]
    .map((g) => ({ ...g, rows: members.get(g.id) ?? [] }))
    .filter((g) => g.rows.length > 0);
}

/**
 * The grid's lines. Grouping by section with a table that has no sections gives the rows alone,
 * with no header: there is nothing to group.
 */
export function gridLines(
  project: ProjectFile,
  source: Source,
  rows: readonly GridRow[],
  by: Grouping,
  collapsed: ReadonlySet<string>,
): Line[] {
  if (by === "section" && (source.sections ?? []).length === 0)
    return rows.map((row) => ({ kind: "row", key: row.key, row }));
  return groups(project, source, rows, by).flatMap((group): Line[] => {
    const key = `group:${by}:${group.id}`;
    const isCollapsed = collapsed.has(key);
    const header: Line = {
      kind: "group",
      key,
      ...(group.label === undefined ? {} : { label: group.label }),
      count: group.rows.length,
      collapsed: isCollapsed,
    };
    return isCollapsed
      ? [header]
      : [header, ...group.rows.map((row): Line => ({ kind: "row", key: row.key, row }))];
  });
}
