/**
 * Filters and bulk actions of the mapping grid (D8): the rows shown by review status, role and
 * section, and the rows a bulk action writes (a role or a review status on several rows at once).
 * Pure: the grid shows what `filterRows` keeps and saves what `bulkRows` gives, in one batch.
 */
import type { MappingRow, Status } from "@cindermed/model";
import type { GridRow } from "./rows";

/** "none": rows without a status, a role or a section. Undefined: no filter on that field. */
export interface RowFilter {
  readonly status: Status | "none" | undefined;
  readonly roleId: string | undefined;
  readonly sectionId: string | undefined;
}

export const NO_FILTER: RowFilter = { status: undefined, roleId: undefined, sectionId: undefined };

export const NONE = "none";

export const STATUSES: readonly Status[] = [
  "todo",
  "draft",
  "toReview",
  "approved",
  "notMappable",
  "excluded",
];

const matches = (wanted: string | undefined, value: string | undefined) =>
  wanted === undefined || wanted === (value ?? NONE);

/** The rows a filter keeps, in their order. A line of a column without rows has no status or role. */
export function filterRows(rows: readonly GridRow[], filter: RowFilter): GridRow[] {
  return rows.filter(
    (row) =>
      matches(filter.status, row.mapping?.review?.status) &&
      matches(filter.roleId, row.mapping?.instanceId) &&
      matches(filter.sectionId, row.column?.sectionId),
  );
}

/** Whether a filter is set. */
export const isFiltered = (filter: RowFilter) =>
  filter.status !== undefined || filter.roleId !== undefined || filter.sectionId !== undefined;

export type BulkAction =
  | { readonly kind: "role"; readonly roleId: string }
  | { readonly kind: "status"; readonly status: Status };

/**
 * The rows a bulk action changes, as they become: only those it really changes. A new status
 * keeps the row's review comments.
 */
export function bulkRows(rows: readonly MappingRow[], action: BulkAction): MappingRow[] {
  return rows.flatMap((row): MappingRow[] => {
    if (action.kind === "role")
      return row.instanceId === action.roleId ? [] : [{ ...row, instanceId: action.roleId }];
    if (row.review?.status === action.status) return [];
    return [{ ...row, review: { ...row.review, status: action.status } }];
  });
}
