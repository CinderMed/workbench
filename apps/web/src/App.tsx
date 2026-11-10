import { Alert, Button, Center, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AuthClient } from "./auth";

type State =
  | { kind: "loading" }
  | { kind: "redirecting" }
  | { kind: "signedIn"; name: string }
  | { kind: "error"; message: string };

export interface AppProps {
  auth: AuthClient;
  location: { href: string };
  replaceUrl: (url: string) => void;
}

/** Module 0 shell: signs the user in through Keycloak and shows who is signed in. */
export function App({ auth, location, replaceUrl }: AppProps) {
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
        {state.kind === "signedIn" && (
          <>
            <Text>{t("auth.signedInAs", { name: state.name })}</Text>
            <Button variant="light" onClick={() => void auth.signOut()}>
              {t("auth.signOut")}
            </Button>
          </>
        )}
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
