import { MantineProvider } from "@mantine/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json";
import { createI18n } from "../i18n";
import type { FileAccess } from "../storage/file-access";
import { type Validator } from "../validation/use-validation";
import { validateAll } from "../validation/validate";
import { LocalApp, type LocalAppProps } from "./LocalApp";

afterEach(cleanup);

const metastraText = JSON.stringify(metastraProject);
/** Validation in the test process, without FHIR definitions. */
const noDefinitions: Validator = (project) =>
  validateAll(project, { message: "no definitions in this test" });

function renderLocal(props: Partial<LocalAppProps> = {}) {
  const download = vi.fn<(name: string, text: string) => void>();
  render(
    <I18nextProvider i18n={createI18n()}>
      <MantineProvider>
        <LocalApp download={download} validator={noDefinitions} {...props} />
      </MantineProvider>
    </I18nextProvider>,
  );
  return { download };
}

const fileInput = () => screen.getByTestId("file-input");

describe("LocalApp", () => {
  it("says it is the local mode and opens project files only", () => {
    renderLocal();
    expect(screen.getByText("Local mode · this computer only")).toBeTruthy();
    expect(fileInput().getAttribute("accept")).toBe(".json,application/json");
  });

  it("opens a project file and shows what it holds", async () => {
    renderLocal();
    await userEvent.upload(fileInput(), new File([metastraText], "metastra.json"));
    expect(await screen.findByText("Metastra")).toBeTruthy();
    expect(
      screen.getByText("metastra.json · FHIR 4.0.1 · 1 tables, 11 columns, 6 roles, 16 rows"),
    ).toBeTruthy();
    expect(
      screen.getByText("This browser cannot write the file: save by downloading it."),
    ).toBeTruthy();
  });

  it("never reads a file that is not named .json, such as a data file", async () => {
    renderLocal();
    const data = new File(["patient_id,age\nMTS-1,40\n"], "visits.csv");
    const read = vi.spyOn(data, "text");
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [data] } });
    expect(
      await screen.findByText(
        "visits.csv was not opened: only project files (.json) can be opened here, never data files.",
      ),
    ).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
  });

  it("explains why a JSON file is not a project", async () => {
    renderLocal();
    await userEvent.upload(fileInput(), new File(['{"formatVersion":"1.4.0"}'], "other.json"));
    expect(await screen.findByText("other.json is not a valid project file")).toBeTruthy();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("downloads the project where the file cannot be written", async () => {
    const { download } = renderLocal();
    await userEvent.upload(fileInput(), new File([metastraText], "metastra.json"));
    await userEvent.click(await screen.findByRole("button", { name: "Download project" }));
    expect(download).toHaveBeenCalledOnce();
    const [name, text] = download.mock.calls[0] ?? [];
    expect(name).toBe("metastra.json");
    expect(JSON.parse(text ?? "{}")).toMatchObject({ project: { name: "Metastra" } });
  });

  it("uses the file picker where the browser has one, and then saves to the file", async () => {
    const write = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const access: FileAccess = {
      name: "metastra.json",
      read: () => Promise.resolve(metastraText),
      write,
    };
    renderLocal({ pickFile: () => Promise.resolve(access) });
    await userEvent.click(screen.getByRole("button", { name: "Open project…" }));
    expect(await screen.findByText("Every change is saved to metastra.json.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download project" })).toBeNull();
  });
});
