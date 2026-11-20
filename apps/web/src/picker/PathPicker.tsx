import { Alert, Badge, Button, Group, Loader, Modal, Stack, Text, TextInput } from "@mantine/core";
import type { TreeNode } from "@cindermed/fhir-defs";
import type { Instance, MappingRow, ProjectFile } from "@cindermed/model";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { roleName } from "../grid/rows";
import { SliceForm } from "../slices/SliceForm";
import { repeats, slicePath } from "../slices/slices";
import type { BrowserDefinitions } from "../validation/index-fetch";
import { type Fit, fitter } from "./fit";
import {
  type Levels,
  type PickerNode,
  cardinality,
  loadLevels,
  roleDefinition,
  treeLines,
} from "./tree";

export interface PathPickerProps {
  readonly role: Instance;
  /** The column the row reads, for the title. */
  readonly columnName?: string;
  /** The row's current path, selected when the picker opens. */
  readonly current?: string;
  readonly definitions: () => Promise<BrowserDefinitions>;
  readonly onPick: (path: string) => void;
  readonly onClose: () => void;
  /**
   * Adds a named slice to the role (D4); resolves to why it was not saved, or undefined. Without
   * it, the picker offers no new slices.
   */
  readonly onCreateSlice?: (slice: Slice) => Promise<string | undefined>;
  /** A new slice id. */
  readonly newSliceId?: () => string;
  /**
   * The row being placed, to grey the elements it cannot be written to (type compatibility).
   * Without it, every element can be chosen.
   */
  readonly fit?: { readonly project: ProjectFile; readonly row: MappingRow };
}

type Slice = NonNullable<Instance["slices"]>[number];

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly found: Extract<BrowserDefinitions, { defs: unknown }>;
      readonly ref: string;
    };

/**
 * The path picker (D3): the element tree of the role's resource or profile, with cardinality and
 * types, searched by name; choice elements under their concrete names (`valueQuantity`). Up and
 * Down move, Right opens, Left closes, Enter chooses. On a repeating element, a new named slice
 * (D4) adds a repetition the rows can write to (`component[nrs].valueInteger`).
 */
export function PathPicker({
  role,
  columnName,
  current,
  definitions,
  onPick,
  onClose,
  onCreateSlice,
  newSliceId,
  fit,
}: PathPickerProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [levels, setLevels] = useState<Levels>(new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | undefined>();
  /** The repeating element a new slice is being named for. */
  const [creating, setCreating] = useState<TreeNode | undefined>();
  const slices = useMemo(() => role.slices ?? [], [role.slices]);
  // The tree depends on the role's type and profile, not on its other fields (a new slice).
  const { resourceType, profile } = role;
  /** The slices when the tree loads, for the prefetch; later ones load when created. */
  const slicesRef = useRef(slices);
  /** Whether the tree takes the focus when it shows again (after the slice form). */
  const refocus = useRef(false);
  const treeRef = useRef<HTMLDivElement>(null);
  const treeId = useId();

  // Declared before the loading effect, so it reads the slices of this render.
  useEffect(() => {
    slicesRef.current = slices;
  }, [slices]);

  useEffect(() => {
    const run = { live: true };
    /** Whether the picker is still open (it may close while definitions load). */
    const live = () => run.live;
    void definitions().then(async (found) => {
      if (!live()) return;
      if ("message" in found) {
        setState({ kind: "unavailable", message: found.message });
        return;
      }
      const ref = roleDefinition(found.defs, {
        resourceType,
        ...(profile === undefined ? {} : { profile }),
      });
      if (ref === undefined) {
        setState({
          kind: "unavailable",
          message: t("picker.unknownType", { type: resourceType }),
        });
        return;
      }
      const loaded = await loadLevels(
        found.defs,
        found.fetch,
        ref,
        "",
        new Map(),
        4,
        slicesRef.current,
      );
      if (!live()) return;
      if ("message" in loaded) setState({ kind: "unavailable", message: loaded.message });
      else {
        setLevels(loaded.levels);
        // Start on the row's current path, with its loaded ancestors open.
        const parts = (current ?? "").split(".");
        const ancestors = new Set(
          parts
            .slice(0, -1)
            .map((_, i) => parts.slice(0, i + 1).join("."))
            .filter((path) => loaded.levels.has(path)),
        );
        setExpanded(ancestors);
        const at = treeLines(loaded.levels, ancestors, "", slicesRef.current).findIndex(
          (l) => l.node.path === current,
        );
        setActive(Math.max(at, 0));
        setState({ kind: "ready", found, ref });
      }
    });
    return () => {
      run.live = false;
    };
  }, [current, definitions, resourceType, profile, t]);

  const lines = useMemo(
    () => treeLines(levels, expanded, query, slices),
    [levels, expanded, query, slices],
  );
  const selected = lines[Math.min(active, Math.max(lines.length - 1, 0))];
  /** How each element fits the row; recomputed when more definitions are loaded. */
  const fitOf = useMemo(
    () =>
      fit === undefined || state.kind !== "ready"
        ? undefined
        : fitter(state.found.defs, state.ref, resourceType, fit.project, fit.row),
    // `levels` changes when documents load, which can change what resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fit, state, resourceType, levels],
  );
  const fitAt = (node: TreeNode): Fit => fitOf?.(node.path) ?? { kind: "ok" };
  /** Chooses an element, unless the row cannot be written to it. */
  const choose = (node: TreeNode) => {
    if (fitAt(node).kind !== "blocked") onPick(node.path);
  };

  const open = async (node: TreeNode) => {
    if (state.kind !== "ready" || !node.expandable) return;
    const loaded = await loadLevels(
      state.found.defs,
      state.found.fetch,
      state.ref,
      node.path,
      levels,
      0,
    );
    if ("message" in loaded) {
      setError(loaded.message);
      return;
    }
    setError(undefined);
    setLevels(loaded.levels);
    setExpanded((e) => new Set(e).add(node.path));
  };

  /** Whether a new named slice can be added on a node: a repeating element, not a slice. */
  const canSlice = (node: PickerNode | undefined): node is PickerNode =>
    onCreateSlice !== undefined &&
    newSliceId !== undefined &&
    node !== undefined &&
    node.sliceId === undefined &&
    node.sliceName === undefined &&
    repeats(node);

  /** Opens the slice form on a repeating element, with its children loaded for the discriminator. */
  const startSlice = async (node: TreeNode) => {
    if (state.kind !== "ready") return;
    const loaded = await loadLevels(
      state.found.defs,
      state.found.fetch,
      state.ref,
      node.path,
      levels,
      0,
    );
    if ("message" in loaded) {
      setError(loaded.message);
      return;
    }
    setError(undefined);
    setLevels(loaded.levels);
    setCreating(node);
  };

  /** Saves a new slice, then shows it open and selected under its element. */
  const saveSlice = async (slice: Slice): Promise<string | undefined> => {
    if (onCreateSlice === undefined || state.kind !== "ready") return undefined;
    const failed = await onCreateSlice(slice);
    if (failed !== undefined) return failed;
    const path = slicePath(slice);
    const loaded = await loadLevels(
      state.found.defs,
      state.found.fetch,
      state.ref,
      path,
      levels,
      0,
    );
    const nextLevels = "message" in loaded ? levels : loaded.levels;
    const nextExpanded = new Set(expanded).add(slice.path);
    if (!("message" in loaded)) nextExpanded.add(path);
    setLevels(nextLevels);
    setExpanded(nextExpanded);
    setQuery("");
    // Select the slice in the lines it shows in, with the role's new slice.
    const at = treeLines(nextLevels, nextExpanded, "", [...slices, slice]).findIndex(
      (l) => l.node.path === path,
    );
    setActive(Math.max(at, 0));
    refocus.current = true;
    setCreating(undefined);
    return undefined;
  };

  useEffect(() => {
    if (creating !== undefined || !refocus.current) return;
    refocus.current = false;
    treeRef.current?.focus();
  }, [creating]);
  const close = (node: TreeNode) => {
    setExpanded((e) => {
      const next = new Set(e);
      next.delete(node.path);
      return next;
    });
  };

  const onKey = (event: KeyboardEvent) => {
    const line = selected;
    const keys: Record<string, () => void> = {
      ArrowDown: () => {
        setActive((a) => Math.min(a + 1, lines.length - 1));
      },
      ArrowUp: () => {
        setActive((a) => Math.max(a - 1, 0));
      },
      ArrowRight: () => {
        if (line?.expanded === false) void open(line.node);
      },
      ArrowLeft: () => {
        if (line?.expanded) close(line.node);
      },
      Enter: () => {
        if (line !== undefined) choose(line.node);
      },
    };
    const action = keys[event.key];
    if (action === undefined) return;
    event.preventDefault();
    action();
  };

  useEffect(() => {
    treeRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const selectedNode = selected?.node;
  const sliceTarget = canSlice(selectedNode) ? selectedNode : undefined;

  const types = (node: TreeNode) => node.types.map((type) => type.code).join(" | ");
  const extra = (node: TreeNode) =>
    node.fixed !== undefined
      ? t("picker.fixed")
      : node.pattern !== undefined
        ? t("picker.pattern")
        : "";

  return (
    <Modal
      opened
      onClose={onClose}
      size="xl"
      title={
        <Group gap="xs">
          <Text fw={600}>
            {columnName === undefined
              ? t("picker.title")
              : t("picker.titleFor", { column: columnName })}
          </Text>
          <Badge variant="light">{roleName(role)}</Badge>
        </Group>
      }
    >
      <Stack gap="sm">
        <TextInput
          label={t("picker.search")}
          value={query}
          data-autofocus
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "Enter") {
              event.preventDefault();
              treeRef.current?.focus();
            }
          }}
        />
        {state.kind === "loading" && <Loader size="sm" />}
        {state.kind === "unavailable" && <Alert color="orange">{state.message}</Alert>}
        {error !== undefined && <Alert color="red">{error}</Alert>}
        {state.kind === "ready" && creating !== undefined && newSliceId !== undefined && (
          <SliceForm
            role={role}
            element={creating}
            elements={levels.get(creating.path) ?? []}
            newId={newSliceId}
            onSave={saveSlice}
            onCancel={() => {
              refocus.current = true;
              setCreating(undefined);
            }}
          />
        )}
        {state.kind === "ready" && creating === undefined && (
          <div
            ref={treeRef}
            id={treeId}
            role="tree"
            aria-label={t("picker.tree", { role: roleName(role) })}
            tabIndex={0}
            onKeyDown={onKey}
            style={{
              maxHeight: "55vh",
              overflow: "auto",
              border: "1px solid var(--mantine-color-default-border)",
              borderRadius: 4,
            }}
          >
            {lines.length === 0 && (
              <Text p="sm" c="dimmed">
                {t("picker.noMatch")}
              </Text>
            )}
            {lines.map((line, i) => {
              const isActive = line === selected;
              const blocked = fitAt(line.node).kind === "blocked";
              return (
                <div
                  key={line.node.path}
                  role="treeitem"
                  aria-level={line.depth + 1}
                  aria-selected={isActive}
                  aria-disabled={blocked || undefined}
                  aria-expanded={line.node.expandable ? line.expanded : undefined}
                  onClick={() => {
                    setActive(i);
                    treeRef.current?.focus();
                  }}
                  onDoubleClick={() => {
                    choose(line.node);
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) 70px minmax(0, 1fr)",
                    gap: 8,
                    padding: "4px 8px",
                    paddingLeft: 8 + line.depth * 18,
                    cursor: "pointer",
                    opacity: blocked ? 0.45 : undefined,
                    background: isActive ? "var(--mantine-color-blue-light)" : undefined,
                    fontFamily: "var(--mantine-font-family-monospace)",
                    fontSize: 13,
                  }}
                >
                  <span>
                    <span
                      aria-hidden
                      onClick={(event) => {
                        event.stopPropagation();
                        if (line.expanded) close(line.node);
                        else void open(line.node);
                      }}
                      style={{ display: "inline-block", width: 16 }}
                    >
                      {line.node.expandable ? (line.expanded ? "▾" : "▸") : ""}
                    </span>
                    {line.node.name}
                  </span>
                  <span>{cardinality(line.node)}</span>
                  <span style={{ color: "var(--mantine-color-dimmed)" }}>
                    {types(line.node)}
                    {extra(line.node) === "" ? "" : ` · ${extra(line.node)}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {selected !== undefined && creating === undefined && <FitNote fit={fitAt(selected.node)} />}
        <Group justify="space-between">
          <Text size="sm">
            {t("picker.selected")}{" "}
            <code data-testid="picker-selected">{selected?.node.path ?? "—"}</code>
          </Text>
          <Group gap="xs">
            {sliceTarget !== undefined && creating === undefined && (
              <Button
                variant="light"
                onClick={() => {
                  void startSlice(sliceTarget);
                }}
              >
                {t("slices.add", { element: sliceTarget.path })}
              </Button>
            )}
            <Button variant="default" onClick={onClose}>
              {t("roles.cancel")}
            </Button>
            <Button
              disabled={
                selected === undefined ||
                creating !== undefined ||
                fitAt(selected.node).kind === "blocked"
              }
              onClick={() => {
                if (selected !== undefined) choose(selected.node);
              }}
            >
              {t("picker.use")}
            </Button>
          </Group>
        </Group>
        <Text size="xs" c="dimmed">
          {t("picker.keys")}
        </Text>
      </Stack>
    </Modal>
  );
}

/** Why the selected element can or cannot take the row. */
function FitNote({ fit }: { readonly fit: Fit }) {
  const { t } = useTranslation();
  if (fit.kind === "ok") return null;
  const text =
    fit.kind === "blocked"
      ? t("picker.blocked", { message: fit.message })
      : fit.kind === "needs"
        ? t("picker.needs", {
            transforms: fit.transforms.map((k) => t(`grid.transform.${k}`)).join(", "),
          })
        : fit.message;
  return (
    <Text size="sm" c={fit.kind === "blocked" ? "red" : "orange"} data-testid="picker-fit">
      {text}
    </Text>
  );
}
