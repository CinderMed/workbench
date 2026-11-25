import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  NativeSelect,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import type { Column, Instance, MappingRow, ProjectFile } from "@cindermed/model";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { roleName } from "../grid/rows";
import { ValueFields } from "../values/ValueFields";
import { errorKey, kindOfType } from "../values/fhir-value";
import {
  CONSTANT_TYPES,
  type EditableKind,
  type TransformDraft,
  buildRow,
  castTypes,
  draftOf,
  kindsFor,
  tableColumns,
} from "./transform-form";

export interface TransformEditorProps {
  readonly project: ProjectFile;
  /** The row to edit; for a new constant row, its first state. */
  readonly row: MappingRow;
  readonly column?: Column;
  /** A new row without a column: the roles it can write to, chosen here with its element. */
  readonly roles?: readonly Instance[];
  /** Saves the row; resolves to why it was not saved, or undefined. */
  readonly onSave: (row: MappingRow) => Promise<string | undefined>;
  readonly onClose: () => void;
}

/**
 * The transform of a row (D5): its kind and fields, and `repeat` for a multiple-choice column.
 * With `roles`, a new constant row: its role and element too.
 */
export function TransformEditor({
  project,
  row,
  column,
  roles,
  onSave,
  onClose,
}: TransformEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<TransformDraft>(() => draftOf(row, column));
  const [roleId, setRoleId] = useState(row.instanceId);
  const [path, setPath] = useState(row.path);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const set = (fields: Partial<TransformDraft>) => {
    setDraft({ ...draft, ...fields });
  };
  const others = tableColumns(project, column).filter((c) => c.id !== column?.id);
  const columnName = (id: string) =>
    tableColumns(project, column).find((c) => c.id === id)?.name ?? id;
  const mapLabel = (id: string) => {
    const map = project.valueMaps.find((v) => v.id === id);
    return map === undefined
      ? id
      : t("transforms.valueMapOption", {
          name: map.name,
          target: map.target,
          count: map.entries.length,
        });
  };
  const mapChoices = [
    { value: "", label: t("transforms.choose") },
    ...project.valueMaps.map((v) => ({ value: v.id, label: mapLabel(v.id) })),
  ];
  const valueKind = kindOfType(draft.valueType);
  const isNew = roles !== undefined;

  const submit = async () => {
    if (isNew && roleId === "") {
      setError(t("transforms.error.roleRequired"));
      return;
    }
    if (isNew && path.trim() === "") {
      setError(t("transforms.error.pathRequired"));
      return;
    }
    const built = buildRow(draft, { ...row, instanceId: roleId, path: path.trim() }, column);
    if ("error" in built) {
      setError(t(errorKey(built.error, "transforms.error")));
      return;
    }
    setSaving(true);
    const failed = await onSave(built.row);
    setSaving(false);
    setError(failed);
  };

  const fields = (kind: EditableKind) => {
    switch (kind) {
      case "copy":
        return null;
      case "cast":
        return (
          <>
            <NativeSelect
              label={t("transforms.field.castTo")}
              value={draft.castTo}
              data={castTypes(column).map((to) => ({ value: to, label: to }))}
              onChange={(event) => {
                set({ castTo: event.currentTarget.value });
              }}
            />
            {(column?.dataType === "date" || column?.dataType === "dateTime") && (
              <TextInput
                label={t("transforms.field.inputFormat")}
                description={t("transforms.field.inputFormatHint")}
                value={draft.inputFormat}
                onChange={(event) => {
                  set({ inputFormat: event.currentTarget.value });
                }}
              />
            )}
          </>
        );
      case "valueMap":
        return project.valueMaps.length === 0 ? (
          <Alert color="orange">{t("transforms.noValueMaps")}</Alert>
        ) : (
          <NativeSelect
            label={t("transforms.field.valueMap")}
            value={draft.valueMapId}
            data={mapChoices}
            onChange={(event) => {
              set({ valueMapId: event.currentTarget.value });
            }}
          />
        );
      case "quantity":
        return (
          <>
            <SegmentedControl
              aria-label={t("transforms.field.unitMode")}
              value={draft.unitMode}
              data={[
                { value: "fixed", label: t("transforms.unitFixed") },
                { value: "column", label: t("transforms.unitColumn") },
              ]}
              onChange={(value) => {
                set({ unitMode: value === "column" ? "column" : "fixed" });
              }}
            />
            {draft.unitMode === "fixed" ? (
              <>
                <TextInput
                  label={t("transforms.field.unit")}
                  description={t("transforms.field.unitHint")}
                  withAsterisk
                  value={draft.unitCode}
                  onChange={(event) => {
                    set({ unitCode: event.currentTarget.value });
                  }}
                />
                <TextInput
                  label={t("transforms.field.unitDisplay")}
                  value={draft.unitDisplay}
                  onChange={(event) => {
                    set({ unitDisplay: event.currentTarget.value });
                  }}
                />
              </>
            ) : (
              <>
                <NativeSelect
                  label={t("transforms.field.unitColumn")}
                  value={draft.unitColumnId}
                  data={[
                    { value: "", label: t("transforms.choose") },
                    ...others.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  onChange={(event) => {
                    set({ unitColumnId: event.currentTarget.value });
                  }}
                />
                <NativeSelect
                  label={t("transforms.field.unitValueMap")}
                  description={t("transforms.field.unitValueMapHint")}
                  value={draft.unitValueMapId}
                  data={mapChoices}
                  onChange={(event) => {
                    set({ unitValueMapId: event.currentTarget.value });
                  }}
                />
              </>
            )}
          </>
        );
      case "coding":
        return (
          <>
            <TextInput
              label={t("values.system")}
              withAsterisk
              value={draft.system}
              onChange={(event) => {
                set({ system: event.currentTarget.value });
              }}
            />
            <NativeSelect
              label={t("transforms.field.as")}
              value={draft.as}
              data={["CodeableConcept", "Coding"]}
              onChange={(event) => {
                set({ as: event.currentTarget.value === "Coding" ? "Coding" : "CodeableConcept" });
              }}
            />
            <NativeSelect
              label={t("transforms.field.displayColumn")}
              value={draft.displayColumnId}
              data={[
                { value: "", label: t("transforms.none") },
                ...others.map((c) => ({ value: c.id, label: c.name })),
              ]}
              onChange={(event) => {
                set({ displayColumnId: event.currentTarget.value });
              }}
            />
          </>
        );
      case "concat":
        return (
          <>
            <Checkbox.Group label={t("transforms.field.columns")}>
              <Stack gap={4} mt={4}>
                {tableColumns(project, column).map((c) => {
                  const at = draft.columnIds.indexOf(c.id);
                  return (
                    <Checkbox
                      key={c.id}
                      value={c.id}
                      checked={at >= 0}
                      label={at >= 0 ? `${String(at + 1)}. ${c.name}` : c.name}
                      onChange={(event) => {
                        set({
                          columnIds: event.currentTarget.checked
                            ? [...draft.columnIds, c.id]
                            : draft.columnIds.filter((id) => id !== c.id),
                        });
                      }}
                    />
                  );
                })}
              </Stack>
            </Checkbox.Group>
            <TextInput
              label={t("transforms.field.separator")}
              value={draft.separator}
              onChange={(event) => {
                set({ separator: event.currentTarget.value });
              }}
            />
            <Text size="sm" c="dimmed">
              {t("transforms.concatOrder", {
                columns: draft.columnIds.map(columnName).join(" + ") || "—",
              })}
            </Text>
          </>
        );
      case "constant":
        return (
          <>
            <NativeSelect
              label={t("transforms.field.valueType")}
              value={draft.valueType}
              data={CONSTANT_TYPES}
              onChange={(event) => {
                set({ valueType: event.currentTarget.value });
              }}
            />
            {valueKind !== undefined && (
              <ValueFields
                kind={valueKind}
                value={draft.value}
                onChange={(value) => {
                  set({ value });
                }}
              />
            )}
          </>
        );
    }
  };

  return (
    <Modal
      opened
      onClose={onClose}
      title={
        <Text fw={600}>
          {isNew
            ? t("transforms.newConstant")
            : t("transforms.title", {
                code: row.code,
                column: column?.name ?? t("grid.noColumn"),
              })}
        </Text>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Stack gap="sm">
          {isNew && (
            <>
              <NativeSelect
                label={t("grid.column.role")}
                value={roleId}
                data={[
                  { value: "", label: t("transforms.choose") },
                  ...roles.map((r) => ({ value: r.id, label: roleName(r) })),
                ]}
                onChange={(event) => {
                  setRoleId(event.currentTarget.value);
                }}
              />
              <TextInput
                label={t("grid.column.element")}
                description={t("transforms.field.pathHint")}
                withAsterisk
                value={path}
                onChange={(event) => {
                  setPath(event.currentTarget.value);
                }}
              />
            </>
          )}
          <NativeSelect
            label={t("transforms.field.kind")}
            data-autofocus
            value={draft.kind}
            data={kindsFor(column).map((k) => ({ value: k, label: t(`grid.transform.${k}`) }))}
            onChange={(event) => {
              const kind = kindsFor(column).find((k) => k === event.currentTarget.value);
              if (kind !== undefined) set({ kind });
            }}
          />
          <Text size="sm" c="dimmed">
            {t(`transforms.help.${draft.kind}`)}
          </Text>
          {fields(draft.kind)}
          {(column?.dataType === "multipleChoice" || draft.repeat) && (
            <Checkbox
              label={t("transforms.field.repeat")}
              description={t("transforms.field.repeatHint")}
              checked={draft.repeat}
              onChange={(event) => {
                set({ repeat: event.currentTarget.checked });
              }}
            />
          )}
          {error !== undefined && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t("roles.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("roles.save")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
