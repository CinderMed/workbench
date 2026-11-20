import { NativeSelect, Text, TextInput } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { ValueDraft, ValueKind } from "./fhir-value";

export interface ValueFieldsProps {
  readonly kind: ValueKind;
  readonly value: ValueDraft;
  readonly onChange: (value: ValueDraft) => void;
}

/** The fields of a typed value: a code system, code and display, or a value of a primitive type. */
export function ValueFields({ kind, value, onChange }: ValueFieldsProps) {
  const { t } = useTranslation();
  const set = (fields: Partial<ValueDraft>) => {
    onChange({ ...value, ...fields });
  };
  if (kind.kind === "coding")
    return (
      <>
        <TextInput
          label={t("values.system")}
          withAsterisk
          value={value.system}
          onChange={(event) => {
            set({ system: event.currentTarget.value });
          }}
        />
        <TextInput
          label={t("values.code")}
          withAsterisk
          value={value.code}
          onChange={(event) => {
            set({ code: event.currentTarget.value });
          }}
        />
        <TextInput
          label={t("values.display")}
          value={value.display}
          onChange={(event) => {
            set({ display: event.currentTarget.value });
          }}
        />
        <Text size="xs" c="dimmed">
          {t("values.manual")}
        </Text>
      </>
    );
  if (kind.type === "boolean")
    return (
      <NativeSelect
        label={t("values.value", { type: kind.type })}
        value={value.value}
        data={[
          { value: "", label: "—" },
          { value: "true", label: "true" },
          { value: "false", label: "false" },
        ]}
        onChange={(event) => {
          set({ value: event.currentTarget.value });
        }}
      />
    );
  return (
    <TextInput
      label={t("values.value", { type: kind.type })}
      withAsterisk
      value={value.value}
      onChange={(event) => {
        set({ value: event.currentTarget.value });
      }}
    />
  );
}
