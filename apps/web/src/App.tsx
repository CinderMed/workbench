import { Alert, AppShell, Button, Center, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ApiClient, createApiClient } from "./api/client";
import type { AuthClient } from "./auth";
import { ProjectsPage } from "./projects/ProjectsPage";

type State =
  | { kind: "loading" }
  | { kind: "redirecting" }
  | { kind: "signedIn"; name: string }
  | { kind: "error"; message: string };

export interface AppProps {
  auth: AuthClient;
  location: { href: string };
  replaceUrl: (url: string) => void;
  /** The API (tests pass their own). Default: the same-origin API with the user's token. */
  api?: ApiClient;
  /** Saves a file on the user's computer. */
  download?: (name: string, text: string) => void;
}

function browserDownload(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** The signed-in app: signs the user in through Keycloak, then shows their projects (A1). */
export function App({ auth, location, replaceUrl, api, download = browserDownload }: AppProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: "loading" });

  const start = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const url = new URL(location.href);
      if (auth.isCallback(url)) {
        const user = await auth.handleCallback();
        replaceUrl(url.pathname);
        setState({ kind: "signedIn", name: user.name });
        return;
      }
      const user = await auth.getUser();
      if (user) {
        setState({ kind: "signedIn", name: user.name });
        return;
      }
      setState({ kind: "redirecting" });
      await auth.signIn();
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [auth, location, replaceUrl]);

  // Run once even under StrictMode: an OIDC callback can be exchanged only once.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  const client = useMemo(
    () =>
      api ??
      createApiClient(auth.accessToken, {
        onUnauthenticated: () => {
          void auth.signIn();
        },
      }),
    [api, auth],
  );

  if (state.kind === "signedIn")
    return (
      <AppShell header={{ height: 56 }} padding={0}>
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between">
            <Group gap="xs">
              <Title order={3}>{t("app.name")}</Title>
              <Text c="dimmed" size="sm">
                {t("app.subtitle")}
              </Text>
            </Group>
            <Group gap="xs">
              <Text size="sm">{t("auth.signedInAs", { name: state.name })}</Text>
              <Button variant="light" size="xs" onClick={() => void auth.signOut()}>
                {t("auth.signOut")}
              </Button>
            </Group>
          </Group>
        </AppShell.Header>
        <AppShell.Main>
          <ProjectsPage api={client} download={download} />
        </AppShell.Main>
      </AppShell>
    );

  return (
    <Center h="100vh">
      <Stack align="center" gap="md">
        <Title order={1}>{t("app.name")}</Title>
        <Text c="dimmed">{t("app.subtitle")}</Text>
        {state.kind === "loading" && (
          <Group gap="xs">
            <Loader size="sm" />
            <Text>{t("auth.loading")}</Text>
          </Group>
        )}
        {state.kind === "redirecting" && <Text>{t("auth.redirecting")}</Text>}
        {state.kind === "error" && (
          <Alert color="red" title={t("auth.error", { message: state.message })}>
            <Button variant="light" color="red" onClick={() => void start()}>
              {t("auth.retry")}
            </Button>
          </Alert>
        )}
      </Stack>
    </Center>
  );
}
