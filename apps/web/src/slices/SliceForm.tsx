import { Alert, Button, Group, NativeSelect, Stack, Text, TextInput } from "@mantine/core";
import type { TreeNode } from "@cindermed/fhir-defs";
import type { Instance } from "@cindermed/model";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ValueFields } from "../values/ValueFields";
import { errorKey } from "../values/fhir-value";
import { type SliceDraft, buildSlice, discriminatorChoices, slicesOn, valueKind } from "./slices";

type Slice = NonNullable<Instance["slices"]>[number];

export interface SliceFormProps {
  readonly role: Instance;
  /** The repeating element the slice is a repetition of. */
  readonly element: TreeNode;
  /** The element's children: the discriminator is one of them. */
  readonly elements: readonly TreeNode[];
  readonly newId: () => string;
  /** Saves the slice; resolves to why it was not saved, or undefined. */
  readonly onSave: (slice: Slice) => Promise<string | undefined>;
  readonly onCancel: () => void;
}

/**
 * A new named slice (D4): its name (`nrs` in `component[nrs]`) and the fixed value of one child
 * that tells it apart from the other repetitions (`code`). A coding typed here is `manual`.
 */
export function SliceForm({ role, element, elements, newId, onSave, onCancel }: SliceFormProps) {
  const { t } = useTranslation();
  const choices = discriminatorChoices(elements);
  const [draft, setDraft] = useState<SliceDraft>({
    name: "",
    discriminatorPath: choices[0]?.name ?? "",
    system: "",
    code: "",
    display: "",
    value: "",
  });
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const chosen = choices.find((c) => c.name === draft.discriminatorPath);
  const kind = chosen === undefined ? undefined : valueKind(chosen);
  const set = (fields: Partial<SliceDraft>) => {
    setDraft({ ...draft, ...fields });
  };

  const submit = async () => {
    const taken = slicesOn(role, element.path).map((s) => s.name);
    const built = buildSlice(newId(), element.path, kind, draft, taken);
    if ("error" in built) {
      setError(t(errorKey(built.error, "slices.error")));
      return;
    }
    setSaving(true);
    const failed = await onSave(built.slice);
    setSaving(false);
    setError(failed);
  };

  return (
    <form
      aria-label={t("slices.formTitle", { element: element.path })}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Stack gap="sm">
        <Text fw={600}>{t("slices.formTitle", { element: element.path })}</Text>
        <Text size="sm" c="dimmed">
          {t("slices.explanation", { element: element.path })}
        </Text>
        <TextInput
          label={t("slices.field.name")}
          description={t("slices.field.nameHint", {
            example: `${element.path}[${draft.name.trim() === "" ? "nrs" : draft.name.trim()}]`,
          })}
          withAsterisk
          data-autofocus
          autoFocus
          value={draft.name}
          onChange={(event) => {
            set({ name: event.currentTarget.value });
          }}
        />
        {choices.length === 0 ? (
          <Alert color="orange">{t("slices.noDiscriminator", { element: element.path })}</Alert>
        ) : (
          <NativeSelect
            label={t("slices.field.discriminator")}
            value={draft.discriminatorPath}
            data={choices.map((c) => ({
              value: c.name,
              label: `${c.name} (${c.types.map((type) => type.code).join(" | ")})`,
            }))}
            onChange={(event) => {
              set({ discriminatorPath: event.currentTarget.value });
            }}
          />
        )}
        {kind !== undefined && (
          <ValueFields
            kind={kind}
            value={draft}
            onChange={(value) => {
              set(value);
            }}
          />
        )}
        {error !== undefined && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            {t("roles.cancel")}
          </Button>
          <Button type="submit" loading={saving} disabled={choices.length === 0}>
            {t("slices.create")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
