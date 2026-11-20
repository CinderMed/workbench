import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  List,
  Paper,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import type { ProjectFile, ValidationResult } from "@cindermed/model";
import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type FileAccess, blobAccess } from "../storage/file-access";
import { MappingGrid } from "../grid/MappingGrid";
import { RolesPanel } from "../roles/RolesPanel";
import { type Validator, useValidation } from "../validation/use-validation";
import { LocalFileStore, NotAProjectError } from "../storage/local-file-store";
import type { Loaded } from "../storage/project-store";

type State =
  | { readonly kind: "empty" }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly results: readonly ValidationResult[];
    }
  | {
      readonly kind: "open";
      readonly store: LocalFileStore;
      readonly project: ProjectFile;
      readonly versions: ReadonlyMap<string, string>;
      readonly migratedFrom?: string;
    };

export interface LocalAppProps {
  /** Opens a file with the File System Access API; absent where the API does not exist. */
  readonly pickFile?: () => Promise<FileAccess | undefined>;
  /** Saves a text as a download. */
  readonly download: (name: string, text: string) => void;
  /** Validates the open project (a Web Worker in the browser, ADR-0021). */
  readonly validator: Validator;
}

/** Only project files are opened, never data files: anything not named .json is not even read. */
const isProjectFileName = (name: string) => name.toLowerCase().endsWith(".json");
const MAX_RESULTS_SHOWN = 10;

/**
 * Local mode (ADR-0021): one project file on this computer, opened from a file, kept in memory and
 * saved back through `LocalFileStore`. Runs only in the Vite dev server, bound to localhost.
 */
export function LocalApp({ pickFile, download, validator }: LocalAppProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: "empty" });
  const input = useRef<HTMLInputElement>(null);

  const open = useCallback(
    async (access: FileAccess) => {
      if (!isProjectFileName(access.name)) {
        setState({
          kind: "error",
          message: t("local.onlyProjectFiles", { file: access.name }),
          results: [],
        });
        return;
      }
      const store = new LocalFileStore(access);
      try {
        const { project, versions } = await store.load();
        setState({
          kind: "open",
          store,
          project,
          versions,
          ...(store.migratedFrom === undefined ? {} : { migratedFrom: store.migratedFrom }),
        });
      } catch (error) {
        setState(
          error instanceof NotAProjectError
            ? {
                kind: "error",
                message: t("local.notAProject", { file: access.name }),
                results: error.results,
              }
            : { kind: "error", message: t("local.cannotRead", { file: access.name }), results: [] },
        );
      }
    },
    [t],
  );

  const onLoaded = useCallback((loaded: Loaded) => {
    setState((current) =>
      current.kind === "open"
        ? { ...current, project: loaded.project, versions: loaded.versions }
        : current,
    );
  }, []);

  const openWithPicker = useCallback(async () => {
    if (pickFile === undefined) {
      input.current?.click();
      return;
    }
    const access = await pickFile();
    if (access !== undefined) await open(access);
  }, [open, pickFile]);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const file = event.dataTransfer.files[0];
      if (file !== undefined) void open(blobAccess(file));
    },
    [open],
  );

  // Closing the tab with changes that only live in memory asks first.
  const store = state.kind === "open" ? state.store : undefined;
  useEffect(() => {
    if (store === undefined) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (store.hasUnsavedChanges) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [store]);

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={1}>{t("app.name")}</Title>
          <Badge color="orange" variant="light">
            {t("local.badge")}
          </Badge>
        </Group>
        <Text c="dimmed">{t("local.explanation")}</Text>

        <Paper
          withBorder
          p="lg"
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={onDrop}
          data-testid="drop-zone"
        >
          <Stack gap="sm" align="flex-start">
            <Text>{t("local.dropHint")}</Text>
            <Button onClick={() => void openWithPicker()}>
              {state.kind === "open" ? t("local.openAnother") : t("local.open")}
            </Button>
            <input
              ref={input}
              type="file"
              accept=".json,application/json"
              hidden
              data-testid="file-input"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file !== undefined) void open(blobAccess(file));
                e.currentTarget.value = "";
              }}
            />
          </Stack>
        </Paper>

        {state.kind === "error" && (
          <Alert color="red" title={state.message}>
            {state.results.length > 0 && (
              <List size="sm">
                {state.results.slice(0, MAX_RESULTS_SHOWN).map((r, i) => (
                  <List.Item key={i}>{r.message}</List.Item>
                ))}
              </List>
            )}
          </Alert>
        )}

        {state.kind === "open" && (
          <Paper withBorder p="lg">
            <Stack gap="xs">
              <Title order={2}>{state.project.project.name}</Title>
              <Text size="sm">
                {t("local.summary", {
                  file: state.store.fileName,
                  fhirVersion: state.project.project.fhirVersion,
                  tables: state.project.sources.length,
                  columns: state.project.sources.reduce((n, s) => n + s.columns.length, 0),
                  roles: state.project.instances.length,
                  rows: state.project.mappings.length,
                })}
              </Text>
              {state.migratedFrom !== undefined && (
                <Text size="sm" c="dimmed">
                  {t("local.migrated", {
                    from: state.migratedFrom,
                    to: state.project.formatVersion,
                  })}
                </Text>
              )}
              <Group gap="sm">
                <Text size="sm">
                  {state.store.canWriteFile
                    ? t("local.savedToFile", { file: state.store.fileName })
                    : state.store.hasUnsavedChanges
                      ? t("local.unsaved")
                      : t("local.downloadToSave")}
                </Text>
                {!state.store.canWriteFile && (
                  <Button
                    variant="light"
                    size="xs"
                    onClick={() => {
                      const saved = state.store.download();
                      download(saved.name, saved.text);
                    }}
                  >
                    {t("local.download")}
                  </Button>
                )}
              </Group>
            </Stack>
          </Paper>
        )}

        {state.kind === "open" && (
          <ProjectView
            project={state.project}
            versions={state.versions}
            store={state.store}
            onLoaded={onLoaded}
            validator={validator}
          />
        )}
      </Stack>
    </Container>
  );
}

interface ProjectViewProps {
  readonly project: ProjectFile;
  readonly versions: ReadonlyMap<string, string>;
  readonly store: LocalFileStore;
  readonly onLoaded: (loaded: Loaded) => void;
  readonly validator: Validator;
}

/** The open project: its validation summary, the grid and the roles. */
function ProjectView({ project, versions, store, onLoaded, validator }: ProjectViewProps) {
  const { t } = useTranslation();
  const state = useValidation(project, validator);
  const validation = state === undefined || "failed" in state ? undefined : state;
  const errors = validation?.results.filter((r) => r.severity === "error").length ?? 0;
  const warnings = (validation?.results.length ?? 0) - errors;
  const fhir = validation?.fhir;
  return (
    <Stack gap="sm">
      <Group gap="xs" data-testid="validation-summary">
        {state !== undefined && "failed" in state ? (
          <Alert color="red" py={4}>
            {t("validation.failed", { message: state.failed })}
          </Alert>
        ) : validation === undefined ? (
          <Text size="sm" c="dimmed">
            {t("validation.running")}
          </Text>
        ) : (
          <>
            <Badge color={errors > 0 ? "red" : "green"} variant="light">
              {t("validation.errors", { count: errors })}
            </Badge>
            <Badge color={warnings > 0 ? "yellow" : "gray"} variant="light">
              {t("validation.warnings", { count: warnings })}
            </Badge>
            <Text size="sm" c="dimmed">
              {fhir?.kind === "checked"
                ? t("validation.fhirChecked", { version: fhir.fhirVersion })
                : fhir?.kind === "otherVersion"
                  ? t("validation.fhirOtherVersion", {
                      index: fhir.indexVersion,
                      project: project.project.fhirVersion,
                    })
                  : fhir?.kind === "unavailable"
                    ? t("validation.fhirUnavailable")
                    : t("validation.fhirNotRun")}
            </Text>
          </>
        )}
      </Group>
      <Tabs defaultValue="grid" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="grid">{t("local.tabGrid")}</Tabs.Tab>
          <Tabs.Tab value="roles">
            {t("local.tabRoles", { count: project.instances.length })}
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="grid" pt="sm">
          <MappingGrid
            project={project}
            versions={versions}
            store={store}
            onLoaded={onLoaded}
            {...(validation === undefined ? {} : { findings: validation.results })}
          />
        </Tabs.Panel>
        <Tabs.Panel value="roles" pt="sm">
          <RolesPanel project={project} versions={versions} store={store} onLoaded={onLoaded} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
