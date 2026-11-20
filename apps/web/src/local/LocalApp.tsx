import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  List,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { ProjectFile, ValidationResult } from "@cindermed/model";
import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type FileAccess, blobAccess } from "../storage/file-access";
import { MappingGrid } from "../grid/MappingGrid";
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
}

/** Only project files are opened, never data files: anything not named .json is not even read. */
const isProjectFileName = (name: string) => name.toLowerCase().endsWith(".json");
const MAX_RESULTS_SHOWN = 10;

/**
 * Local mode (ADR-0021): one project file on this computer, opened from a file, kept in memory and
 * saved back through `LocalFileStore`. Runs only in the Vite dev server, bound to localhost.
 */
export function LocalApp({ pickFile, download }: LocalAppProps) {
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
          <MappingGrid
            project={state.project}
            versions={state.versions}
            store={state.store}
            onLoaded={onLoaded}
          />
        )}
      </Stack>
    </Container>
  );
}
