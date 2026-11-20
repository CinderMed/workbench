import { MantineProvider } from "@mantine/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "../i18n";
import { type FileAccess, type FileHandle, handleAccess } from "../storage/file-access";
import { browserDefinitions } from "../validation/index-fetch";
import { workerValidator } from "../validation/use-validation";
import { LocalApp } from "./LocalApp";

/** The File System Access API's picker, where the browser has it (Chromium). */
type OpenFilePicker = (options: {
  types: { description: string; accept: Record<string, string[]> }[];
  multiple: false;
}) => Promise<FileHandle[]>;

function filePicker(): (() => Promise<FileAccess | undefined>) | undefined {
  const picker = (window as unknown as { showOpenFilePicker?: OpenFilePicker }).showOpenFilePicker;
  if (picker === undefined) return undefined;
  return async () => {
    try {
      const [handle] = await picker.call(window, {
        types: [{ description: "CinderMed project", accept: { "application/json": [".json"] } }],
        multiple: false,
      });
      return handle === undefined ? undefined : handleAccess(handle);
    } catch {
      return undefined; // The user closed the picker.
    }
  };
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Starts the local mode (ADR-0021). Imported only by the Vite dev server: see main.tsx. */
export function startLocalMode(root: HTMLElement): void {
  const pickFile = filePicker();
  const definitions = browserDefinitions();
  const validator = workerValidator(
    new Worker(new URL("../validation/validation.worker.ts", import.meta.url), { type: "module" }),
  );
  createRoot(root).render(
    <StrictMode>
      <I18nextProvider i18n={createI18n()}>
        <MantineProvider defaultColorScheme="auto">
          <LocalApp
            {...(pickFile === undefined ? {} : { pickFile })}
            download={download}
            validator={validator}
            definitions={definitions}
          />
        </MantineProvider>
      </I18nextProvider>
    </StrictMode>,
  );
}
