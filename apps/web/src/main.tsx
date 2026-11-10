import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { App } from "./App";
import { createAuthClient } from "./auth";
import { readWebConfig } from "./config";
import { createI18n } from "./i18n";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

const auth = createAuthClient(readWebConfig(import.meta.env), window.location.origin);
const replaceUrl = (url: string) => {
  window.history.replaceState(null, "", url);
};

createRoot(root).render(
  <StrictMode>
    <I18nextProvider i18n={createI18n()}>
      <MantineProvider defaultColorScheme="auto">
        <App auth={auth} location={window.location} replaceUrl={replaceUrl} />
      </MantineProvider>
    </I18nextProvider>
  </StrictMode>,
);
