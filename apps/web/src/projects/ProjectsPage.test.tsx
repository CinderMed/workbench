import { MantineProvider } from "@mantine/core";
import type { ProjectFile } from "@cindermed/model";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import metastraText from "../../../../fixtures/fml-examples/metastra/project.json?raw";
import { type ApiClient, ApiError, type ProjectSummary } from "../api/client";
import { createI18n } from "../i18n";
import { mockLayout } from "../test-layout";
import { ProjectsPage } from "./ProjectsPage";

afterEach(cleanup);

function fakeApi(start: ProjectSummary[] = []) {
  const projects = [...start];
  const imported: unknown[] = [];
  const api: ApiClient = {
    me: vi.fn(),
    projects: vi.fn(() => Promise.resolve([...projects])),
    importProject: vi.fn((file: unknown) => {
      imported.push(file);
      const project = (file as ProjectFile).project;
      projects.push({
        id: project.id,
        name: project.name,
        fhirVersion: project.fhirVersion,
        role: "owner",
      });
      return Promise.resolve({ id: project.id });
    }),
    exportProject: vi.fn((id: string) => Promise.resolve(`{"id":"${id}"}`)),
  };
  return { api, imported };
}

function renderPage(api: ApiClient) {
  const restore = mockLayout(1200);
  const download = vi.fn<(name: string, text: string) => void>();
  render(
    <I18nextProvider i18n={createI18n()}>
      <MantineProvider>
        <ProjectsPage api={api} download={download} />
      </MantineProvider>
    </I18nextProvider>,
  );
  return { download, restore };
}

const motu: ProjectSummary = { id: "prj_motu", name: "MOTU", fhirVersion: "4.0.1", role: "owner" };
const watched: ProjectSummary = {
  id: "prj_watch",
  name: "Watched",
  fhirVersion: "5.0.0",
  role: "viewer",
};

describe("the projects page (A1, #18)", () => {
  it("lists the projects with the caller's role, and exports one as JSON", async () => {
    const { api } = fakeApi([motu, watched]);
    const { download, restore } = renderPage(api);
    const table = await screen.findByRole("table", { name: "Projects" });
    expect(within(table).getByText("MOTU")).toBeTruthy();
    expect(within(table).getByText("Viewer")).toBeTruthy();
    // A viewer cannot export: no button on that line.
    expect(screen.queryByRole("button", { name: "Export Watched as JSON" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Export MOTU as JSON" }));
    await waitFor(() => {
      expect(download).toHaveBeenCalledWith("prj_motu.json", '{"id":"prj_motu"}');
    });
    restore();
  });

  it("creates a project from the form, after naming what is missing", async () => {
    const { api, imported } = fakeApi();
    const { restore } = renderPage(api);
    await screen.findByText("You have no projects yet: create one, or import a project file.");
    await userEvent.click(screen.getByRole("button", { name: "New project" }));
    const dialog = await screen.findByRole("dialog", { name: "New project" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
    expect(within(dialog).getAllByText("Required")).toHaveLength(4);
    expect(api.importProject).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByLabelText(/^Name/), "Pain study");
    await userEvent.click(within(dialog).getByText("R5 (5.0.0)"));
    await userEvent.type(
      within(dialog).getByLabelText(/^Canonical base/),
      "https://example.org/fhir/pain",
    );
    await userEvent.type(within(dialog).getByLabelText(/^First table/), "Visits");
    await userEvent.type(within(dialog).getByLabelText(/^Its columns/), "patient;score");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
    expect(await screen.findByText("Project Pain study was created.")).toBeTruthy();
    const [file] = imported as ProjectFile[];
    expect(file?.project).toMatchObject({ name: "Pain study", fhirVersion: "5.0.0" });
    expect(file?.sources[0]?.columns.map((c) => c.name)).toEqual(["patient", "score"]);
    expect(await screen.findByRole("table", { name: "Projects" })).toBeTruthy();
    restore();
  });

  it("imports a project file, and says why one is refused", async () => {
    const { api } = fakeApi();
    const { restore } = renderPage(api);
    await screen.findByText(/You have no projects yet/);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("no file input");
    await userEvent.upload(
      input,
      new File([metastraText], "metastra.json", { type: "application/json" }),
    );
    expect(await screen.findByText("metastra.json was imported.")).toBeTruthy();
    expect(api.importProject).toHaveBeenCalledWith(JSON.parse(metastraText));

    vi.mocked(api.importProject).mockRejectedValueOnce(
      new ApiError({
        code: "invalid-project-file",
        status: 422,
        title: "The project file is not valid",
        detail: "The file does not match the project schema, or cannot be migrated.",
        results: [
          {
            severity: "error",
            code: "SCHEMA_VIOLATION",
            objectKind: "project",
            message: "sources is required",
          },
        ],
      }),
    );
    await userEvent.upload(input, new File(["{}"], "empty.json", { type: "application/json" }));
    expect(
      await screen.findByText(/empty.json was not imported: The file does not match/),
    ).toBeTruthy();
    expect(screen.getByText("sources is required")).toBeTruthy();

    await userEvent.upload(
      input,
      new File(["patient;score"], "data.json", { type: "application/json" }),
    );
    expect(await screen.findByText(/data.json is not a JSON file/)).toBeTruthy();
    restore();
  });

  it("says when the projects cannot be loaded, and retries", async () => {
    const { api } = fakeApi([motu]);
    vi.mocked(api.projects).mockRejectedValueOnce(new Error("API unreachable"));
    const { restore } = renderPage(api);
    expect(
      await screen.findByText("The projects could not be loaded: API unreachable"),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table", { name: "Projects" })).toBeTruthy();
    restore();
  });
});
