/**
 * The projects of the signed-in user (A1, H3, #18): the list with the caller's role, a new
 * project, a project file imported, and a project exported as JSON. Everything goes through the
 * API; nothing about a project is kept in the browser.
 */
import {
  Alert,
  Badge,
  Button,
  FileButton,
  Group,
  Loader,
  List,
  Modal,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { FHIR_VERSIONS } from "@cindermed/model";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ApiClient, ApiError, type ProjectSummary } from "../api/client";
import {
  type DraftError,
  EMPTY_DRAFT,
  type NewProjectDraft,
  buildProject,
} from "./new-project-form";

export interface ProjectsPageProps {
  readonly api: ApiClient;
  /** Saves a file on the user's computer. */
  readonly download: (name: string, text: string) => void;
}

type Load =
  | { kind: "loading" }
  | { kind: "ready"; projects: ProjectSummary[] }
  | { kind: "error"; message: string };

type Notice = { kind: "ok" | "error"; text: string; details?: readonly string[] } | undefined;

/** The first findings of a refused file, as their messages (never values). */
function details(error: unknown): readonly string[] {
  if (!(error instanceof ApiError)) return [];
  return (error.problem.results ?? []).slice(0, 5).map((r) => r.message);
}

export function ProjectsPage({ api, download }: ProjectsPageProps) {
  const { t } = useTranslation();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [notice, setNotice] = useState<Notice>();
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoad({ kind: "ready", projects: await api.projects() });
    } catch (error) {
      setLoad({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [api]);
  // The first load; later loads (after an import or a creation, or a retry) call `refresh`.
  useEffect(() => {
    let current = true;
    api.projects().then(
      (projects) => {
        if (current) setLoad({ kind: "ready", projects });
      },
      (error: unknown) => {
        if (current)
          setLoad({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => {
      current = false;
    };
  }, [api]);

  const importFile = async (file: File | null) => {
    if (file === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setNotice({ kind: "error", text: t("projects.notJson", { file: file.name }) });
      return;
    }
    try {
      await api.importProject(parsed);
      setNotice({ kind: "ok", text: t("projects.imported", { file: file.name }) });
      await refresh();
    } catch (error) {
      setNotice({
        kind: "error",
        text: t("projects.importFailed", {
          file: file.name,
          message: error instanceof Error ? error.message : String(error),
        }),
        details: details(error),
      });
    }
  };

  const exportProject = async (project: ProjectSummary) => {
    try {
      download(`${project.id}.json`, await api.exportProject(project.id));
    } catch (error) {
      setNotice({
        kind: "error",
        text: t("projects.exportFailed", {
          name: project.name,
          message: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  };

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between">
        <Title order={2}>{t("projects.title")}</Title>
        <Group gap="xs">
          <FileButton onChange={(file) => void importFile(file)} accept="application/json,.json">
            {(props) => (
              <Button variant="default" {...props}>
                {t("projects.import")}
              </Button>
            )}
          </FileButton>
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            {t("projects.new")}
          </Button>
        </Group>
      </Group>

      {notice !== undefined && (
        <Alert
          color={notice.kind === "ok" ? "green" : "red"}
          withCloseButton
          onClose={() => {
            setNotice(undefined);
          }}
          title={notice.text}
        >
          {notice.details !== undefined && notice.details.length > 0 && (
            <List size="sm">
              {notice.details.map((d, i) => (
                <List.Item key={i}>{d}</List.Item>
              ))}
            </List>
          )}
        </Alert>
      )}

      {load.kind === "loading" && (
        <Group gap="xs">
          <Loader size="sm" />
          <Text>{t("projects.loading")}</Text>
        </Group>
      )}
      {load.kind === "error" && (
        <Alert color="red" title={t("projects.loadFailed", { message: load.message })}>
          <Button variant="light" color="red" onClick={() => void refresh()}>
            {t("auth.retry")}
          </Button>
        </Alert>
      )}
      {load.kind === "ready" && load.projects.length === 0 && (
        <Text c="dimmed">{t("projects.none")}</Text>
      )}
      {load.kind === "ready" && load.projects.length > 0 && (
        <Table aria-label={t("projects.title")} striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("projects.name")}</Table.Th>
              <Table.Th>{t("projects.fhirVersion")}</Table.Th>
              <Table.Th>{t("projects.role")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {load.projects.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>{p.name}</Table.Td>
                <Table.Td>{p.fhirVersion}</Table.Td>
                <Table.Td>
                  <Badge variant="light">{t(`projects.roles.${p.role}`)}</Badge>
                </Table.Td>
                <Table.Td>
                  {p.role !== "viewer" && (
                    <Button
                      size="xs"
                      variant="subtle"
                      aria-label={t("projects.exportOne", { name: p.name })}
                      onClick={() => void exportProject(p)}
                    >
                      {t("projects.export")}
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <NewProjectModal
        opened={creating}
        api={api}
        onClose={() => {
          setCreating(false);
        }}
        onCreated={(name) => {
          setCreating(false);
          setNotice({ kind: "ok", text: t("projects.created", { name }) });
          void refresh();
        }}
      />
    </Stack>
  );
}

interface NewProjectModalProps {
  readonly opened: boolean;
  readonly api: ApiClient;
  readonly onClose: () => void;
  readonly onCreated: (name: string) => void;
}

function NewProjectModal({ opened, api, onClose, onCreated }: NewProjectModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<NewProjectDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<readonly DraftError[]>([]);
  const [failure, setFailure] = useState<{ text: string; details: readonly string[] }>();
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<NewProjectDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  };
  const errorOf = (field: DraftError["field"]) => {
    const found = errors.filter((e) => e.field === field);
    if (found.length === 0) return undefined;
    return found
      .map((e) =>
        e.key === "header"
          ? e.message
          : e.key === "packageFormat"
            ? t("projects.form.packageFormat", { line: e.line })
            : t(`projects.form.${e.key}`),
      )
      .join("; ");
  };

  const submit = async () => {
    const built = buildProject(draft);
    if ("errors" in built) {
      setErrors(built.errors);
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      await api.importProject(built.project);
      setDraft(EMPTY_DRAFT);
      setFailure(undefined);
      onCreated(built.project.project.name);
    } catch (error) {
      setFailure({
        text: error instanceof Error ? error.message : String(error),
        details: details(error),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={t("projects.new")} size="lg">
      <Stack gap="sm">
        <TextInput
          label={t("projects.form.name")}
          withAsterisk
          value={draft.name}
          error={errorOf("name")}
          onChange={(e) => {
            set({ name: e.currentTarget.value });
          }}
        />
        <Textarea
          label={t("projects.form.description")}
          rows={2}
          value={draft.description}
          onChange={(e) => {
            set({ description: e.currentTarget.value });
          }}
        />
        <div>
          <Text size="sm" fw={500}>
            {t("projects.fhirVersion")}
          </Text>
          <SegmentedControl
            aria-label={t("projects.fhirVersion")}
            value={draft.fhirVersion}
            data={FHIR_VERSIONS.map((v) => ({ value: v, label: t(`projects.form.fhir.${v}`) }))}
            onChange={(value) => {
              set({ fhirVersion: value });
            }}
          />
        </div>
        <TextInput
          label={t("projects.form.canonicalBase")}
          description={t("projects.form.canonicalBaseHint")}
          withAsterisk
          value={draft.canonicalBase}
          error={errorOf("canonicalBase")}
          onChange={(e) => {
            set({ canonicalBase: e.currentTarget.value });
          }}
        />
        <Textarea
          label={t("projects.form.packages")}
          description={t("projects.form.packagesHint")}
          rows={2}
          value={draft.packages}
          error={errorOf("packages")}
          onChange={(e) => {
            set({ packages: e.currentTarget.value });
          }}
        />
        <TextInput
          label={t("projects.form.table")}
          withAsterisk
          value={draft.table}
          error={errorOf("table")}
          onChange={(e) => {
            set({ table: e.currentTarget.value });
          }}
        />
        <Textarea
          label={t("projects.form.columns")}
          description={t("projects.form.columnsHint")}
          withAsterisk
          rows={3}
          value={draft.columns}
          error={errorOf("columns")}
          onChange={(e) => {
            set({ columns: e.currentTarget.value });
          }}
        />
        {failure !== undefined && (
          <Alert color="red" title={t("projects.createFailed", { message: failure.text })}>
            {failure.details.length > 0 && (
              <List size="sm">
                {failure.details.map((d, i) => (
                  <List.Item key={i}>{d}</List.Item>
                ))}
              </List>
            )}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("roles.cancel")}
          </Button>
          <Button loading={saving} onClick={() => void submit()}>
            {t("projects.form.create")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
