import {
  Alert,
  Badge,
  Button,
  CloseButton,
  Group,
  Modal,
  NativeSelect,
  NumberInput,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { type Instance, type ProjectFile, objectKey } from "@cindermed/model";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { roleName } from "../grid/rows";
import type { Loaded, ProjectStore, StoreResult } from "../storage/project-store";
import { describeDiscriminator, rowsUsingSlice, slicePath, withoutSlice } from "../slices/slices";
import { defaultIdRule, describeIdRule, nextIndex, rowsUsing } from "./role-defaults";

type Slice = NonNullable<Instance["slices"]>[number];

export interface RolesPanelProps {
  readonly project: ProjectFile;
  readonly versions: ReadonlyMap<string, string>;
  readonly store: Pick<ProjectStore, "apply" | "newId">;
  readonly onLoaded: (loaded: Loaded) => void;
}

interface Form {
  /** The role being edited, or undefined for a new one. */
  readonly role?: Instance;
  readonly resourceType: string;
  /** The index as typed: empty while the field is cleared to type another one. */
  readonly index: number | "";
  /** Whether the index was typed by hand (otherwise it follows the resource type). */
  readonly indexTouched: boolean;
  readonly label: string;
  readonly sourceId: string;
  readonly error?: string;
}

/**
 * The minimal role editor (#174): create, edit and delete roles with their resource type, index,
 * label and table, and a default id rule from the table's row key; the role's named slices (D4),
 * added from the path picker, are listed and can be deleted. The rest of a role is module 6.
 */
export function RolesPanel({ project, versions, store, onLoaded }: RolesPanelProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<Form | undefined>();
  const [deleting, setDeleting] = useState<Instance | undefined>();
  const [deletingSlice, setDeletingSlice] = useState<
    { readonly role: Instance; readonly slice: Slice } | undefined
  >();
  const [notice, setNotice] = useState<string | undefined>();
  const sources = new Map(project.sources.map((s) => [s.id, s.name]));

  const failure = (result: Exclude<StoreResult, { ok: true }>): string => {
    if (result.reason === "invalid") return result.results.map((r) => r.message).join("; ");
    if (result.reason === "conflict") {
      onLoaded(result.current);
      return t("grid.conflict");
    }
    return t("grid.notSaved", { message: result.message });
  };

  const openNew = () => {
    const sourceId = project.sources[0].id;
    setForm({ resourceType: "", index: 0, indexTouched: false, label: "", sourceId });
  };
  const openEdit = (role: Instance) => {
    setForm({
      role,
      resourceType: role.resourceType,
      index: role.index,
      indexTouched: true,
      label: role.label ?? "",
      sourceId: role.sourceId,
    });
  };

  const save = async (form: Form) => {
    if (form.index === "") {
      setForm({ ...form, error: t("roles.indexRequired") });
      return;
    }
    const current = { ...form, index: form.index };
    const resourceType = current.resourceType.trim();
    const label = current.label.trim();
    const fields = {
      resourceType,
      index: current.index,
      sourceId: current.sourceId,
      ...(label === "" ? {} : { label }),
    };
    const role = current.role;
    let result: StoreResult;
    if (role === undefined) {
      const idRule = defaultIdRule(project, current.sourceId, resourceType, current.index);
      const created: Instance = {
        id: store.newId("instance"),
        ...fields,
        multiplicity: { kind: "perRow" },
        ...(idRule === undefined ? {} : { idRule }),
      };
      result = await store.apply([{ op: "create", kind: "instance", value: created }]);
    } else {
      // The id rule follows the role while it is still the default one.
      const before = defaultIdRule(project, role.sourceId, role.resourceType, role.index);
      const isDefault = JSON.stringify(role.idRule) === JSON.stringify(before);
      const after = defaultIdRule(project, current.sourceId, resourceType, current.index);
      const idRule = isDefault ? after : role.idRule;
      const updated: Instance = { ...role, ...fields };
      // An emptied label and a dropped id rule are removed, not kept from before.
      if (label === "") delete updated.label;
      if (idRule === undefined) delete updated.idRule;
      else updated.idRule = idRule;
      const version = versions.get(objectKey("instance", role.id));
      result = await store.apply([
        {
          op: "update",
          kind: "instance",
          id: role.id,
          value: updated,
          ...(version === undefined ? {} : { readVersion: version }),
        },
      ]);
    }
    if (result.ok) {
      onLoaded(result);
      setForm(undefined);
    } else setForm({ ...current, error: failure(result) });
  };

  const remove = async (role: Instance) => {
    const version = versions.get(objectKey("instance", role.id));
    const result = await store.apply([
      {
        op: "delete",
        kind: "instance",
        id: role.id,
        ...(version === undefined ? {} : { readVersion: version }),
      },
    ]);
    setDeleting(undefined);
    if (result.ok) onLoaded(result);
    else setNotice(failure(result));
  };

  const removeSlice = async (role: Instance, slice: Slice) => {
    const version = versions.get(objectKey("instance", role.id));
    const result = await store.apply([
      {
        op: "update",
        kind: "instance",
        id: role.id,
        value: withoutSlice(role, slice.id),
        ...(version === undefined ? {} : { readVersion: version }),
      },
    ]);
    setDeletingSlice(undefined);
    if (result.ok) onLoaded(result);
    else setNotice(failure(result));
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text c="dimmed" size="sm">
          {t("roles.explanation")}
        </Text>
        <Button onClick={openNew}>{t("roles.add")}</Button>
      </Group>
      {notice !== undefined && (
        <Alert
          color="orange"
          withCloseButton
          onClose={() => {
            setNotice(undefined);
          }}
        >
          {notice}
        </Alert>
      )}
      {project.instances.length === 0 ? (
        <Text>{t("roles.none")}</Text>
      ) : (
        <Table striped aria-label={t("roles.title")}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("roles.column.role")}</Table.Th>
              <Table.Th>{t("roles.column.table")}</Table.Th>
              <Table.Th>{t("roles.column.idRule")}</Table.Th>
              <Table.Th>{t("roles.column.slices")}</Table.Th>
              <Table.Th>{t("roles.column.rows")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {project.instances.map((role) => (
              <Table.Tr key={role.id}>
                <Table.Td>{roleName(role)}</Table.Td>
                <Table.Td>{sources.get(role.sourceId) ?? t("roles.tableMissing")}</Table.Td>
                <Table.Td style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
                  {describeIdRule(project, role.idRule) ?? t("roles.noIdRule")}
                </Table.Td>
                <Table.Td>
                  {(role.slices ?? []).length === 0 ? (
                    <Text size="sm" c="dimmed">
                      {t("roles.noSlices")}
                    </Text>
                  ) : (
                    <Group gap={4}>
                      {(role.slices ?? []).map((slice) => (
                        <Badge
                          key={slice.id}
                          variant="light"
                          tt="none"
                          title={describeDiscriminator(slice)}
                          rightSection={
                            <CloseButton
                              size="xs"
                              aria-label={t("roles.deleteSlice", {
                                slice: slicePath(slice),
                                role: roleName(role),
                              })}
                              onClick={() => {
                                setDeletingSlice({ role, slice });
                              }}
                            />
                          }
                        >
                          {slicePath(slice)}
                        </Badge>
                      ))}
                    </Group>
                  )}
                </Table.Td>
                <Table.Td>{rowsUsing(project, role.id)}</Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    <Button
                      size="xs"
                      variant="light"
                      aria-label={t("roles.editRole", { role: roleName(role) })}
                      onClick={() => {
                        openEdit(role);
                      }}
                    >
                      {t("roles.edit")}
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      aria-label={t("roles.deleteRole", { role: roleName(role) })}
                      onClick={() => {
                        setDeleting(role);
                      }}
                    >
                      {t("roles.delete")}
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal
        opened={form !== undefined}
        onClose={() => {
          setForm(undefined);
        }}
        title={
          form?.role === undefined
            ? t("roles.add")
            : t("roles.editTitle", { role: roleName(form.role) })
        }
      >
        {form !== undefined && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save(form);
            }}
          >
            <Stack gap="sm">
              <TextInput
                label={t("roles.field.resourceType")}
                description={t("roles.field.resourceTypeHint")}
                required
                data-autofocus
                value={form.resourceType}
                onChange={(event) => {
                  const resourceType = event.currentTarget.value;
                  setForm({
                    ...form,
                    resourceType,
                    ...(form.indexTouched
                      ? {}
                      : { index: nextIndex(project, resourceType.trim(), form.role?.id) }),
                  });
                }}
              />
              <NumberInput
                label={t("roles.field.index")}
                min={0}
                allowDecimal={false}
                value={form.index}
                onChange={(value) => {
                  setForm({
                    ...form,
                    index: typeof value === "number" ? value : "",
                    indexTouched: true,
                  });
                }}
              />
              <TextInput
                label={t("roles.field.label")}
                value={form.label}
                onChange={(event) => {
                  setForm({ ...form, label: event.currentTarget.value });
                }}
              />
              <NativeSelect
                label={t("roles.field.table")}
                value={form.sourceId}
                data={project.sources.map((s) => ({ value: s.id, label: s.name }))}
                onChange={(event) => {
                  setForm({ ...form, sourceId: event.currentTarget.value });
                }}
              />
              <Text size="sm" c="dimmed">
                {form.role === undefined
                  ? (describeIdRule(
                      project,
                      defaultIdRule(
                        project,
                        form.sourceId,
                        form.resourceType.trim(),
                        form.index === "" ? 0 : form.index,
                      ),
                    ) ?? t("roles.noRowKey"))
                  : t("roles.idRuleKept")}
              </Text>
              {form.error !== undefined && <Alert color="red">{form.error}</Alert>}
              <Group justify="flex-end">
                <Button
                  variant="default"
                  onClick={() => {
                    setForm(undefined);
                  }}
                >
                  {t("roles.cancel")}
                </Button>
                <Button type="submit">{t("roles.save")}</Button>
              </Group>
            </Stack>
          </form>
        )}
      </Modal>

      <Modal
        opened={deleting !== undefined}
        onClose={() => {
          setDeleting(undefined);
        }}
        title={deleting === undefined ? "" : t("roles.deleteTitle", { role: roleName(deleting) })}
      >
        {deleting !== undefined && (
          <Stack gap="sm">
            <Text>{t("roles.deleteWarning", { count: rowsUsing(project, deleting.id) })}</Text>
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => {
                  setDeleting(undefined);
                }}
              >
                {t("roles.cancel")}
              </Button>
              <Button
                color="red"
                onClick={() => {
                  void remove(deleting);
                }}
              >
                {t("roles.delete")}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
      <Modal
        opened={deletingSlice !== undefined}
        onClose={() => {
          setDeletingSlice(undefined);
        }}
        title={
          deletingSlice === undefined
            ? ""
            : t("roles.deleteSliceTitle", {
                slice: slicePath(deletingSlice.slice),
                role: roleName(deletingSlice.role),
              })
        }
      >
        {deletingSlice !== undefined && (
          <Stack gap="sm">
            <Text>
              {t("roles.deleteSliceWarning", {
                count: rowsUsingSlice(project, deletingSlice.role.id, deletingSlice.slice),
              })}
            </Text>
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => {
                  setDeletingSlice(undefined);
                }}
              >
                {t("roles.cancel")}
              </Button>
              <Button
                color="red"
                onClick={() => {
                  void removeSlice(deletingSlice.role, deletingSlice.slice);
                }}
              >
                {t("roles.delete")}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
