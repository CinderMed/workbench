import { Alert, Badge, Button, Group, SegmentedControl, Stack, Text, Tooltip } from "@mantine/core";
import {
  type Instance,
  type MappingRow,
  type ProjectFile,
  type Severity,
  type ValidationResult,
  nextRowCode,
  objectKey,
} from "@cindermed/model";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { Loaded, ProjectStore, StoreChange, StoreResult } from "../storage/project-store";
import { PathPicker } from "../picker/PathPicker";
import { withSlice } from "../slices/slices";
import { TransformEditor } from "../transforms/TransformEditor";
import type { BrowserDefinitions } from "../validation/index-fetch";
import { type CellAddress, type CellFinding, cellFindings } from "./findings";
import { type Grouping, type Line, gridLines } from "./groups";
import { type GridRow, gridRows, roleName, valuesSummary } from "./rows";

export const ROW_HEIGHT = 40;

/** The grid's columns, in order; `editable` ones open an editor with Enter. */
const COLUMNS = [
  { id: "code", width: "90px" },
  { id: "column", width: "minmax(160px, 1.4fr)" },
  { id: "type", width: "110px" },
  { id: "role", width: "minmax(160px, 1.2fr)", editable: true },
  { id: "element", width: "minmax(180px, 1.5fr)", editable: true },
  { id: "transform", width: "120px", dialog: true },
  { id: "values", width: "minmax(140px, 1fr)", dialog: true },
  { id: "status", width: "110px" },
] as const;
type ColumnId = (typeof COLUMNS)[number]["id"];
const TEMPLATE = COLUMNS.map((c) => c.width).join(" ");
const isEditable = (col: number) => {
  const column = COLUMNS[col];
  return column !== undefined && "editable" in column;
};
/** Cells edited in a dialog: the transform editor (D5). */
const isDialog = (col: number) => {
  const column = COLUMNS[col];
  return column !== undefined && "dialog" in column;
};

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, Line>();
const tableColumns = helper.columns(COLUMNS.map((c) => helper.display({ id: c.id, header: c.id })));

/** A row being created: a column with no mapping row yet, and what has been chosen so far. */
interface Draft {
  readonly instanceId?: string;
  readonly path?: string;
}

interface Editing {
  readonly row: number;
  readonly col: number;
  readonly value: string;
}

export interface MappingGridProps {
  readonly project: ProjectFile;
  readonly versions: ReadonlyMap<string, string>;
  readonly store: Pick<ProjectStore, "apply" | "newId">;
  /** The project after an accepted change, or the current one after a conflict. */
  readonly onLoaded: (loaded: Loaded) => void;
  /** Validation results of the current project (D7 inline): their cells are coloured. */
  readonly findings?: readonly ValidationResult[];
  /** A cell to select (from the list of findings); a new `nonce` selects it again. */
  readonly target?: { readonly address: CellAddress; readonly nonce: number };
  /** The FHIR definitions for the path picker (D3); without them Element is typed by hand. */
  readonly definitions?: () => Promise<BrowserDefinitions>;
}

/**
 * The mapping grid (D1): one table at a time, one line per mapping row and one per column without
 * rows; Role and Element are edited from the keyboard. Rows are virtualized, so only the visible
 * lines are in the page.
 */
export function MappingGrid({
  project,
  versions,
  store,
  onLoaded,
  findings,
  target,
  definitions,
}: MappingGridProps) {
  const detailsId = useId();
  const { t } = useTranslation();
  const [sourceId, setSourceId] = useState(project.sources[0].id);
  const source = project.sources.find((s) => s.id === sourceId) ?? project.sources[0];
  const rows = useMemo(() => gridRows(project, source), [project, source]);
  const cells = useMemo(() => cellFindings(rows, findings ?? []), [rows, findings]);
  const [grouping, setGrouping] = useState<Grouping>("section");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const lines = useMemo(
    () => gridLines(project, source, rows, grouping, collapsed),
    [project, source, rows, grouping, collapsed],
  );
  const table = useTable({ features, columns: tableColumns, data: lines, getRowId: (l) => l.key });
  const model = table.getRowModel().rows;
  /** The grid row on a line, or undefined on a group header. */
  const rowAt = useCallback(
    (index: number): GridRow | undefined => {
      const line = model[index]?.original;
      return line?.kind === "row" ? line.row : undefined;
    },
    [model],
  );
  const toggleGroup = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };

  const [active, setActive] = useState({ row: 0, col: 1 });
  const [editing, setEditingState] = useState<Editing | undefined>();
  /** The edit in progress, read synchronously: Enter and the blur that follows commit once. */
  const editingRef = useRef<Editing | undefined>(undefined);
  const setEditing = useCallback((next: Editing | undefined) => {
    editingRef.current = next;
    setEditingState(next);
  }, []);
  const [drafts, setDrafts] = useState<ReadonlyMap<string, Draft>>(new Map());
  /** Input the store refused, kept in its cell with the reason (ADR-0021). */
  const [refused, setRefused] = useState<ReadonlyMap<string, { value: string; message: string }>>(
    new Map(),
  );
  const [notice, setNotice] = useState<string | undefined>();

  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // React Compiler cannot memoize TanStack Virtual's API and skips this component, which is what
  // the grid needs: the virtual rows must follow every scroll and resize.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: model.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => model[index]?.id ?? index,
    overscan: 8,
  });

  const lastRow = Math.max(model.length - 1, 0);
  useEffect(() => {
    if (active.row > lastRow) setActive((a) => ({ ...a, row: lastRow }));
  }, [active.row, lastRow]);

  const move = useCallback(
    (row: number, col: number) => {
      const next = {
        row: Math.min(Math.max(row, 0), lastRow),
        col: Math.min(Math.max(col, 0), COLUMNS.length - 1),
      };
      setActive(next);
      virtualizer.scrollToIndex(next.row, { align: "auto" });
    },
    [lastRow, virtualizer],
  );

  // Select a cell asked from outside: its table, its group opened, then the cell itself.
  const [pending, setPending] = useState<CellAddress | undefined>();
  useEffect(() => {
    if (target === undefined) return;
    setSourceId(target.address.sourceId);
    setPending(target.address);
  }, [target]);
  useEffect(() => {
    if (pending?.sourceId !== source.id) return;
    const all = gridLines(project, source, rows, grouping, new Set());
    const at = all.findIndex((l) => l.kind === "row" && l.key === pending.rowKey);
    const header = all
      .slice(0, Math.max(at, 0))
      .reverse()
      .find((l) => l.kind === "group");
    if (header !== undefined && collapsed.has(header.key)) {
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(header.key);
        return next;
      });
      return; // Selected once the group is open.
    }
    const index = lines.findIndex((l) => l.kind === "row" && l.key === pending.rowKey);
    setPending(undefined);
    if (index < 0) return;
    setEditing(undefined);
    const col = COLUMNS.findIndex((c) => c.id === pending.column);
    move(index, col < 0 ? 0 : col);
    gridRef.current?.focus();
  }, [pending, source, project, rows, grouping, collapsed, lines, move, setEditing]);

  const roles = project.instances;
  const cellKey = (row: GridRow, col: ColumnId) => `${row.key}/${col}`;

  const report = useCallback(
    (result: StoreResult, key: string, value: string): boolean => {
      if (result.ok) {
        onLoaded(result);
        setRefused((m) => withoutKey(m, key));
        return true;
      }
      if (result.reason === "invalid")
        setRefused((m) => new Map(m).set(key, { value, message: firstMessage(result.results) }));
      else if (result.reason === "conflict") {
        onLoaded(result.current);
        setNotice(t("grid.conflict"));
      } else setNotice(t("grid.notSaved", { message: result.message }));
      return false;
    },
    [onLoaded, t],
  );

  const commit = useCallback(
    async (rowIndex: number, col: number, value: string) => {
      const row = rowAt(rowIndex);
      const column = COLUMNS[col]?.id;
      if (row === undefined || (column !== "role" && column !== "element")) return;
      const key = cellKey(row, column);
      const mapping = row.mapping;
      if (mapping !== undefined) {
        const next: MappingRow =
          column === "role"
            ? { ...mapping, instanceId: value }
            : { ...mapping, path: value.trim() };
        if (next.instanceId === mapping.instanceId && next.path === mapping.path) return;
        const change: StoreChange = {
          op: "update",
          kind: "mapping",
          id: mapping.id,
          value: next,
          ...readVersion(versions, objectKey("mapping", mapping.id)),
        };
        report(await store.apply([change]), key, value);
        return;
      }
      // A column without rows: keep the choices until role and element are both set.
      if (row.column === undefined) return;
      const columnId = row.column.id;
      const draft: Draft = {
        ...drafts.get(columnId),
        ...(column === "role" ? { instanceId: value } : { path: value.trim() }),
      };
      setDrafts((m) => new Map(m).set(columnId, draft));
      if (!draft.instanceId || !draft.path) return;
      const created: MappingRow = {
        id: store.newId("mapping"),
        code: nextRowCode(project),
        columnId,
        instanceId: draft.instanceId,
        path: draft.path,
        transform: { kind: "copy" },
      };
      if (
        report(await store.apply([{ op: "create", kind: "mapping", value: created }]), key, value)
      )
        setDrafts((m) => withoutKey(m, columnId));
    },
    [drafts, project, report, rowAt, store, versions],
  );

  const startEditing = useCallback(
    (rowIndex: number, col: number) => {
      const row = rowAt(rowIndex);
      if (row === undefined || !isEditable(col)) return;
      const column = COLUMNS[col]?.id;
      const draft = row.column === undefined ? undefined : drafts.get(row.column.id);
      const kept = column === undefined ? undefined : refused.get(cellKey(row, column));
      const value =
        kept?.value ??
        (column === "role"
          ? (row.mapping?.instanceId ?? draft?.instanceId ?? "")
          : (row.mapping?.path ?? draft?.path ?? ""));
      setEditing({ row: rowIndex, col, value });
    },
    [drafts, refused, rowAt, setEditing],
  );

  const stopEditing = useCallback(
    (save: boolean, then?: { row: number; col: number }) => {
      const current = editingRef.current;
      if (current === undefined) return;
      setEditing(undefined);
      if (save) void commit(current.row, current.col, current.value);
      if (then !== undefined) move(then.row, then.col);
      gridRef.current?.focus();
    },
    [commit, move, setEditing],
  );

  /** The path picker, open on a row (D3). */
  const [picking, setPicking] = useState<{ row: number; roleId: string } | undefined>();
  /** The picker's role as it is now: a slice added in the picker shows in it. */
  const pickingRole =
    picking === undefined ? undefined : roles.find((r) => r.id === picking.roleId);
  /** Adds a named slice to a role (D4): the reason it was not saved, or undefined. */
  const createSlice = async (
    role: Instance,
    slice: NonNullable<Instance["slices"]>[number],
  ): Promise<string | undefined> => {
    const result = await store.apply([
      {
        op: "update",
        kind: "instance",
        id: role.id,
        value: withSlice(role, slice),
        ...readVersion(versions, objectKey("instance", role.id)),
      },
    ]);
    return answer(result);
  };
  /** Takes a store's answer: undefined when saved, else why not (a conflict reloads). */
  const answer = (result: StoreResult): string | undefined => {
    if (result.ok) {
      onLoaded(result);
      return undefined;
    }
    if (result.reason === "invalid") return firstMessage(result.results);
    if (result.reason === "conflict") {
      onLoaded(result.current);
      return t("grid.conflict");
    }
    return t("grid.notSaved", { message: result.message });
  };

  /** The transform editor (D5): on a row, or on a new constant row. */
  const [transforming, setTransforming] = useState<
    { readonly rowId: string } | { readonly constant: MappingRow } | undefined
  >();
  const tableRoles = roles.filter((r) => r.sourceId === source.id);
  const editTransform = (rowIndex: number) => {
    const mapping = rowAt(rowIndex)?.mapping;
    if (mapping === undefined) setNotice(t("transforms.needsRow"));
    else if (mapping.transform.kind === "reference") setNotice(t("transforms.reference"));
    else if (mapping.transform.kind === "expression") setNotice(t("transforms.expression"));
    else setTransforming({ rowId: mapping.id });
  };
  const addConstant = () => {
    if (tableRoles.length === 0) {
      setNotice(t("transforms.noRoles"));
      return;
    }
    setTransforming({
      constant: {
        id: store.newId("mapping"),
        code: nextRowCode(project),
        instanceId: tableRoles.length === 1 ? (tableRoles[0]?.id ?? "") : "",
        path: "",
        transform: { kind: "constant", value: { type: "string", value: "" } },
      },
    });
  };
  const saveTransform = async (row: MappingRow, isNew: boolean) => {
    const failed = answer(
      await store.apply([
        isNew
          ? { op: "create", kind: "mapping", value: row }
          : {
              op: "update",
              kind: "mapping",
              id: row.id,
              value: row,
              ...readVersion(versions, objectKey("mapping", row.id)),
            },
      ]),
    );
    if (failed === undefined) {
      setTransforming(undefined);
      gridRef.current?.focus();
    }
    return failed;
  };
  const transformRow =
    transforming === undefined
      ? undefined
      : "constant" in transforming
        ? transforming.constant
        : project.mappings.find((m) => m.id === transforming.rowId);
  const transformColumn =
    transformRow?.columnId === undefined
      ? undefined
      : project.sources.flatMap((s) => s.columns).find((c) => c.id === transformRow.columnId);

  const ELEMENT = COLUMNS.findIndex((c) => c.id === "element");
  /** Enter or a double-click: the path picker on Element when it can open, else the editor. */
  const edit = (rowIndex: number, col: number) => {
    const row = rowAt(rowIndex);
    if (isDialog(col)) {
      editTransform(rowIndex);
      return;
    }
    if (col !== ELEMENT || definitions === undefined || row === undefined) {
      startEditing(rowIndex, col);
      return;
    }
    const roleId =
      row.mapping?.instanceId ??
      (row.column === undefined ? undefined : drafts.get(row.column.id)?.instanceId);
    const role = roles.find((r) => r.id === roleId);
    if (role === undefined) {
      setNotice(t("picker.noRole"));
      return;
    }
    setPicking({ row: rowIndex, roleId: role.id });
  };

  const onGridKey = (event: KeyboardEvent) => {
    if (editing !== undefined) return;
    const { row, col } = active;
    const keys: Record<string, () => void> = {
      ArrowUp: () => {
        move(row - 1, col);
      },
      ArrowDown: () => {
        move(row + 1, col);
      },
      ArrowLeft: () => {
        move(row, col - 1);
      },
      ArrowRight: () => {
        move(row, col + 1);
      },
      Home: () => {
        move(row, 0);
      },
      End: () => {
        move(row, COLUMNS.length - 1);
      },
      Tab: () => {
        const last = COLUMNS.length - 1;
        if (event.shiftKey) move(col > 0 ? row : row - 1, col > 0 ? col - 1 : last);
        else move(col < last ? row : row + 1, col < last ? col + 1 : 0);
      },
      Enter: () => {
        const line = model[row]?.original;
        if (line?.kind === "group") toggleGroup(line.key);
        else edit(row, col);
      },
      F2: () => {
        if (isDialog(col)) editTransform(row);
        else startEditing(row, col);
      },
    };
    const action = keys[event.key];
    if (action === undefined) return;
    if (
      event.key === "Tab" &&
      ((event.shiftKey && row === 0 && col === 0) ||
        (!event.shiftKey && row === lastRow && col === COLUMNS.length - 1))
    )
      return; // Leave the grid.
    event.preventDefault();
    action();
  };

  const onEditorKey = (event: KeyboardEvent) => {
    if (editing === undefined) return;
    if (event.key === "Escape") {
      event.preventDefault();
      stopEditing(false);
    } else if (event.key === "Enter") {
      event.preventDefault();
      stopEditing(true, { row: editing.row + 1, col: editing.col });
    } else if (event.key === "Tab") {
      event.preventDefault();
      stopEditing(true, { row: editing.row, col: editing.col + (event.shiftKey ? -1 : 1) });
    }
  };

  const display = (row: GridRow, column: ColumnId): ReactNode => {
    const draft = row.column === undefined ? undefined : drafts.get(row.column.id);
    const kept = refused.get(cellKey(row, column));
    if (kept !== undefined) return kept.value;
    switch (column) {
      case "code":
        return row.mapping?.code ?? "";
      case "column":
        return row.column?.name ?? t("grid.noColumn");
      case "type":
        return row.column === undefined ? "" : t(`grid.dataType.${row.column.dataType}`);
      case "role": {
        const id = row.mapping?.instanceId ?? draft?.instanceId;
        const role = roles.find((r) => r.id === id);
        return role === undefined
          ? id === undefined
            ? "—"
            : t("grid.roleMissing")
          : roleName(role);
      }
      case "element":
        return row.mapping?.path ?? draft?.path ?? "—";
      case "transform":
        return row.mapping === undefined ? "—" : t(`grid.transform.${row.mapping.transform.kind}`);
      case "values": {
        const summary = valuesSummary(project, row.mapping);
        return summary.kind === "none" ? "—" : t(`grid.values.${summary.kind}`, summary);
      }
      case "status":
        return row.mapping?.review === undefined
          ? ""
          : t(`grid.status.${row.mapping.review.status}`);
    }
  };

  const editor = (row: GridRow, column: ColumnId, value: string) => {
    const label = t(`grid.column.${column}`);
    const change = (next: string) => {
      if (editingRef.current !== undefined) setEditing({ ...editingRef.current, value: next });
    };
    return column === "role" ? (
      <select
        aria-label={label}
        autoFocus
        value={value}
        onChange={(e) => {
          change(e.currentTarget.value);
        }}
        onKeyDown={onEditorKey}
        onBlur={() => {
          stopEditing(true);
        }}
        style={{ width: "100%" }}
      >
        <option value="">—</option>
        {rolesFor(roles, row.column === undefined ? undefined : source.id).map((r) => (
          <option key={r.id} value={r.id}>
            {roleName(r)}
          </option>
        ))}
      </select>
    ) : (
      <input
        aria-label={label}
        autoFocus
        value={value}
        onChange={(e) => {
          change(e.currentTarget.value);
        }}
        onKeyDown={onEditorKey}
        onBlur={() => {
          stopEditing(true);
        }}
        style={{ width: "100%", fontFamily: "var(--mantine-font-family-monospace)" }}
      />
    );
  };

  const items = virtualizer.getVirtualItems();
  const activeRow = rowAt(active.row);
  const activeColumn = COLUMNS[active.col]?.id;
  const activeKey =
    activeRow === undefined || activeColumn === undefined
      ? undefined
      : cellKey(activeRow, activeColumn);
  const activeCell =
    activeRow === undefined || activeColumn === undefined
      ? undefined
      : `${activeRow.mapping?.code ?? activeRow.column?.name ?? ""} · ${t(`grid.column.${activeColumn}`)}`;
  return (
    <div>
      <Group justify="space-between" mb="xs">
        {project.sources.length > 1 ? (
          <SegmentedControl
            aria-label={t("grid.tables")}
            value={source.id}
            onChange={(id) => {
              setSourceId(id);
              setActive({ row: 0, col: 1 });
              setEditing(undefined);
            }}
            data={project.sources.map((s) => ({ value: s.id, label: s.name }))}
          />
        ) : (
          <Text fw={500}>{source.name}</Text>
        )}
        <Group gap="xs">
          <SegmentedControl
            aria-label={t("grid.grouping")}
            size="xs"
            value={grouping}
            onChange={(value) => {
              setGrouping(value === "role" ? "role" : "section");
              setActive({ row: 0, col: 1 });
              setEditing(undefined);
            }}
            data={[
              { value: "section", label: t("grid.bySection") },
              { value: "role", label: t("grid.byRole") },
            ]}
          />
          <Button size="xs" variant="light" onClick={addConstant}>
            {t("grid.addConstant")}
          </Button>
          <Badge variant="light">{t("grid.rowCount", { count: rows.length })}</Badge>
        </Group>
      </Group>
      {notice !== undefined && (
        <Alert
          color="orange"
          mb="xs"
          withCloseButton
          onClose={() => {
            setNotice(undefined);
          }}
        >
          {notice}
        </Alert>
      )}
      <div
        ref={gridRef}
        role="grid"
        aria-describedby={detailsId}
        aria-label={t("grid.label", { table: source.name })}
        aria-rowcount={lines.length + 1}
        aria-colcount={COLUMNS.length}
        tabIndex={0}
        onKeyDown={onGridKey}
        style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 4 }}
      >
        <div role="row" aria-rowindex={1} style={rowStyle(true)}>
          {table.getHeaderGroups()[0]?.headers.map((header, col) => (
            <div
              key={header.id}
              role="columnheader"
              aria-colindex={col + 1}
              style={cellStyle(false, undefined)}
            >
              {t(`grid.column.${header.column.id}`)}
            </div>
          ))}
        </div>
        <div ref={scrollRef} data-testid="grid-scroll" style={{ height: "60vh", overflow: "auto" }}>
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {items.map((item) => {
              const row = model[item.index];
              if (row === undefined) return null;
              const line = row.original;
              if (line.kind === "group") {
                const isActive = active.row === item.index;
                return (
                  <div
                    key={row.id}
                    role="row"
                    aria-rowindex={item.index + 2}
                    aria-expanded={!line.collapsed}
                    data-index={item.index}
                    style={{
                      ...groupStyle,
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${String(item.start)}px)`,
                    }}
                  >
                    <div
                      role="gridcell"
                      aria-colindex={1}
                      aria-colspan={COLUMNS.length}
                      aria-selected={isActive}
                      onClick={() => {
                        setActive({ row: item.index, col: active.col });
                        toggleGroup(line.key);
                        gridRef.current?.focus();
                      }}
                      style={{
                        ...cellStyle(isActive, undefined),
                        gridColumn: "1 / -1",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {line.collapsed ? "▸ " : "▾ "}
                      {line.label ??
                        (grouping === "section" ? t("grid.noSection") : t("grid.noRole"))}
                      <Text span c="dimmed" ml={8} size="sm">
                        {t("grid.rowCount", { count: line.count })}
                      </Text>
                    </div>
                  </div>
                );
              }
              const gridRow = line.row;
              return (
                <div
                  key={row.id}
                  role="row"
                  aria-rowindex={item.index + 2}
                  data-index={item.index}
                  style={{
                    ...rowStyle(false),
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${String(item.start)}px)`,
                  }}
                >
                  {COLUMNS.map((column, col) => {
                    const isActive = active.row === item.index && active.col === col;
                    const kept = refused.get(cellKey(gridRow, column.id));
                    const found = cells.get(cellKey(gridRow, column.id));
                    return (
                      <div
                        key={column.id}
                        role="gridcell"
                        aria-colindex={col + 1}
                        aria-selected={isActive}
                        aria-invalid={
                          kept !== undefined || found?.severity === "error" ? true : undefined
                        }
                        data-severity={kept === undefined ? found?.severity : "error"}
                        aria-describedby={isActive ? detailsId : undefined}
                        onClick={() => {
                          // A click inside the open editor stays there (it would blur and save it).
                          if (
                            editingRef.current?.row === item.index &&
                            editingRef.current.col === col
                          )
                            return;
                          setActive({ row: item.index, col });
                          gridRef.current?.focus();
                        }}
                        onDoubleClick={() => {
                          setActive({ row: item.index, col });
                          edit(item.index, col);
                        }}
                        style={cellStyle(isActive, kept === undefined ? found?.severity : "error")}
                      >
                        {editing?.row === item.index && editing.col === col ? (
                          editor(gridRow, column.id, editing.value)
                        ) : kept !== undefined || found !== undefined ? (
                          <Tooltip
                            label={tooltip(kept?.message, found)}
                            openDelay={400}
                            multiline
                            maw={420}
                            withinPortal
                          >
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                              {display(gridRow, column.id)}
                            </span>
                          </Tooltip>
                        ) : (
                          display(gridRow, column.id)
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {picking !== undefined && pickingRole !== undefined && definitions !== undefined && (
        <PathPicker
          role={pickingRole}
          {...(rowAt(picking.row)?.column === undefined
            ? {}
            : { columnName: rowAt(picking.row)?.column?.name ?? "" })}
          {...(rowAt(picking.row)?.mapping === undefined
            ? {}
            : { current: rowAt(picking.row)?.mapping?.path ?? "" })}
          definitions={definitions}
          onCreateSlice={(slice) => createSlice(pickingRole, slice)}
          newSliceId={() => store.newId("slice")}
          onClose={() => {
            setPicking(undefined);
            gridRef.current?.focus();
          }}
          onPick={(path) => {
            const row = picking.row;
            setPicking(undefined);
            void commit(row, ELEMENT, path);
            gridRef.current?.focus();
          }}
        />
      )}
      {transforming !== undefined && transformRow !== undefined && (
        <TransformEditor
          key={transformRow.id}
          project={project}
          row={transformRow}
          {...(transformColumn === undefined ? {} : { column: transformColumn })}
          {...("constant" in transforming ? { roles: tableRoles } : {})}
          onSave={(row) => saveTransform(row, "constant" in transforming)}
          onClose={() => {
            setTransforming(undefined);
            gridRef.current?.focus();
          }}
        />
      )}
      <CellDetails
        id={detailsId}
        refusedMessage={activeKey === undefined ? undefined : refused.get(activeKey)?.message}
        finding={activeKey === undefined ? undefined : cells.get(activeKey)}
        cell={activeCell}
      />
      <Text size="xs" c="dimmed" mt={4}>
        {t("grid.keys")}
      </Text>
    </div>
  );
}

/** The roles a row can choose: the table's roles first, then the others (references, `via`). */
function rolesFor(roles: readonly Instance[], sourceId: string | undefined): Instance[] {
  return [...roles].sort(
    (a, b) => Number(b.sourceId === sourceId) - Number(a.sourceId === sourceId),
  );
}

function readVersion(versions: ReadonlyMap<string, string>, key: string) {
  const version = versions.get(key);
  return version === undefined ? {} : { readVersion: version };
}

function withoutKey<V>(map: ReadonlyMap<string, V>, key: string): Map<string, V> {
  const next = new Map(map);
  next.delete(key);
  return next;
}

function firstMessage(results: readonly ValidationResult[]): string {
  return results[0]?.message ?? "";
}

function rowStyle(header: boolean) {
  return {
    display: "grid",
    gridTemplateColumns: TEMPLATE,
    height: ROW_HEIGHT,
    borderBottom: "1px solid var(--mantine-color-default-border)",
    ...(header ? { fontWeight: 600, background: "var(--mantine-color-default-hover)" } : {}),
  } as const;
}

const groupStyle = {
  display: "grid",
  gridTemplateColumns: TEMPLATE,
  height: ROW_HEIGHT,
  borderBottom: "1px solid var(--mantine-color-default-border)",
  background: "var(--mantine-color-default-hover)",
} as const;

function cellStyle(active: boolean, severity: Severity | undefined) {
  return {
    padding: "0 8px",
    display: "flex",
    alignItems: "center",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    outline: active ? "2px solid var(--mantine-color-blue-filled)" : undefined,
    outlineOffset: -2,
    background:
      severity === "error"
        ? "var(--mantine-color-red-light)"
        : severity === "warning"
          ? "var(--mantine-color-yellow-light)"
          : undefined,
  } as const;
}

/** The tooltip of a cell with findings: each one on its line, errors first. */
function tooltip(refusedMessage: string | undefined, finding: CellFinding | undefined): ReactNode {
  const lines = [
    ...(refusedMessage === undefined ? [] : [refusedMessage]),
    ...(finding?.items.map((r) => `${r.code}: ${r.message}`) ?? []),
  ];
  return lines.map((line, i) => <div key={i}>{line}</div>);
}

/**
 * The details bar under the grid: every finding on the active cell (severity, code, message),
 * following the selection from the mouse and the keyboard. The grid and the active cell point to
 * it with aria-describedby.
 */
function CellDetails({
  id,
  cell,
  refusedMessage,
  finding,
}: {
  readonly id: string;
  readonly cell: string | undefined;
  readonly refusedMessage: string | undefined;
  readonly finding: CellFinding | undefined;
}) {
  const { t } = useTranslation();
  const empty = refusedMessage === undefined && finding === undefined;
  return (
    <div
      id={id}
      data-testid="cell-details"
      style={{
        marginTop: 6,
        padding: "6px 8px",
        minHeight: 36,
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: 4,
      }}
    >
      {cell === undefined ? (
        <Text size="sm" c="dimmed">
          {t("details.noCell")}
        </Text>
      ) : empty ? (
        <Text size="sm" c="dimmed">
          {t("details.none", { cell })}
        </Text>
      ) : (
        <Stack gap={2}>
          <Text size="xs" c="dimmed">
            {cell}
          </Text>
          {refusedMessage !== undefined && (
            // A div, not a <p>: the badge inside is a block element.
            <Text size="sm" component="div">
              <Badge color="red" size="sm" mr={6}>
                {t("details.notSaved")}
              </Badge>
              {refusedMessage}
            </Text>
          )}
          {finding?.items.map((r, i) => (
            <Text size="sm" component="div" key={i}>
              <Badge color={r.severity === "error" ? "red" : "yellow"} size="sm" mr={6}>
                {t(`details.${r.severity}`)}
              </Badge>
              <code>{r.code}</code> {r.message}
            </Text>
          ))}
        </Stack>
      )}
    </div>
  );
}
