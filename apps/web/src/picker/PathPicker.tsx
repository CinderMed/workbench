import { Alert, Badge, Button, Group, Loader, Modal, Stack, Text, TextInput } from "@mantine/core";
import type { TreeNode } from "@cindermed/fhir-defs";
import type { Instance } from "@cindermed/model";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { roleName } from "../grid/rows";
import type { BrowserDefinitions } from "../validation/index-fetch";
import { type Levels, cardinality, loadLevels, roleDefinition, treeLines } from "./tree";

export interface PathPickerProps {
  readonly role: Instance;
  /** The column the row reads, for the title. */
  readonly columnName?: string;
  /** The row's current path, selected when the picker opens. */
  readonly current?: string;
  readonly definitions: () => Promise<BrowserDefinitions>;
  readonly onPick: (path: string) => void;
  readonly onClose: () => void;
}

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
 * Down move, Right opens, Left closes, Enter chooses.
 */
export function PathPicker({
  role,
  columnName,
  current,
  definitions,
  onPick,
  onClose,
}: PathPickerProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [levels, setLevels] = useState<Levels>(new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const treeRef = useRef<HTMLDivElement>(null);
  const treeId = useId();

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
      const ref = roleDefinition(found.defs, role);
      if (ref === undefined) {
        setState({
          kind: "unavailable",
          message: t("picker.unknownType", { type: role.resourceType }),
        });
        return;
      }
      const loaded = await loadLevels(found.defs, found.fetch, ref, "", new Map());
      if (!live()) return;
      if ("message" in loaded) setState({ kind: "unavailable", message: loaded.message });
      else {
        setLevels(loaded.levels);
        // Start on the row's current path when it is on the first level.
        const at = treeLines(loaded.levels, new Set(), "").findIndex(
          (l) => l.node.path === current,
        );
        setActive(Math.max(at, 0));
        setState({ kind: "ready", found, ref });
      }
    });
    return () => {
      run.live = false;
    };
  }, [current, definitions, role, t]);

  const lines = useMemo(() => treeLines(levels, expanded, query), [levels, expanded, query]);
  const selected = lines[Math.min(active, Math.max(lines.length - 1, 0))];

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
        if (line !== undefined) onPick(line.node.path);
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
        {state.kind === "ready" && (
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
              return (
                <div
                  key={line.node.path}
                  role="treeitem"
                  aria-level={line.depth + 1}
                  aria-selected={isActive}
                  aria-expanded={line.node.expandable ? line.expanded : undefined}
                  onClick={() => {
                    setActive(i);
                    treeRef.current?.focus();
                  }}
                  onDoubleClick={() => {
                    onPick(line.node.path);
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) 70px minmax(0, 1fr)",
                    gap: 8,
                    padding: "4px 8px",
                    paddingLeft: 8 + line.depth * 18,
                    cursor: "pointer",
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
        <Group justify="space-between">
          <Text size="sm">
            {t("picker.selected")}{" "}
            <code data-testid="picker-selected">{selected?.node.path ?? "—"}</code>
          </Text>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              {t("roles.cancel")}
            </Button>
            <Button
              disabled={selected === undefined}
              onClick={() => {
                if (selected !== undefined) onPick(selected.node.path);
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
