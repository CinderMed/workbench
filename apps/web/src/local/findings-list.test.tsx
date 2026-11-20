import { MantineProvider } from "@mantine/core";
import { isProjectFile, type ProjectFile } from "@cindermed/model";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json";
import motuProject from "../../../../fixtures/fml-examples/motu/project.json";
import { gridLines } from "../grid/groups";
import { gridRows } from "../grid/rows";
import { createI18n } from "../i18n";
import { mockLayout } from "../test-layout";
import { validateAll } from "../validation/validate";
import { LocalApp } from "./LocalApp";

let restore: (() => void) | undefined;
beforeEach(() => {
  restore = mockLayout(400);
});
afterEach(() => {
  cleanup();
  restore?.();
});

const load = (document: unknown): ProjectFile => {
  const copy = JSON.parse(JSON.stringify(document)) as unknown;
  if (!isProjectFile(copy)) throw new Error("not a project");
  return copy;
};

/** Opens a project in the local mode, validated without FHIR definitions (model checks only). */
async function openProject(project: ProjectFile) {
  render(
    <I18nextProvider i18n={createI18n()}>
      <MantineProvider>
        <LocalApp
          download={vi.fn()}
          validator={(p) => validateAll(p, { message: "no definitions in this test" })}
        />
      </MantineProvider>
    </I18nextProvider>,
  );
  await userEvent.upload(
    screen.getByTestId("file-input"),
    new File([JSON.stringify(project)], "p.json"),
  );
  await waitFor(() => {
    expect(
      within(screen.getByTestId("validation-summary")).queryByText("Show all findings"),
    ).toBeTruthy();
  });
}

const activeCell = () =>
  within(screen.getByRole("grid"))
    .getAllByRole("gridcell")
    .find((c) => c.getAttribute("aria-selected") === "true");

describe("the list of all findings", () => {
  it("selects the cell of a finding, switching to its table", async () => {
    const user = userEvent.setup();
    const project = load(motuProject);
    const row = project.mappings.find((m) => m.code === "R-004");
    if (row === undefined) throw new Error("MOTU has R-004");
    row.instanceId = "ins_nobody"; // A row whose role does not exist: an integrity error.
    await openProject(project);
    expect(screen.getByRole("grid").getAttribute("aria-label")).toBe(
      "Mapping grid of table MotuPatient",
    );
    await user.click(screen.getByRole("button", { name: "Show all findings" }));
    const list = await screen.findByRole("table", { name: "All findings" });
    const go = within(list)
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-label")?.includes("ins_nobody"));
    if (go === undefined) throw new Error("the finding about ins_nobody");
    await user.click(go);
    await waitFor(() => {
      expect(screen.getByRole("grid").getAttribute("aria-label")).toBe(
        "Mapping grid of table HospitalStay",
      );
    });
    await waitFor(() => {
      expect(activeCell()?.getAttribute("aria-colindex")).toBe("4"); // Role
    });
    const activeRow = activeCell()?.closest('[role="row"]');
    expect(activeRow && within(activeRow as HTMLElement).getByText("R-004")).toBeTruthy();
    expect(screen.getByTestId("cell-details").textContent).toContain("ins_nobody");
  });

  it("opens the group of a finding's cell when it was closed", async () => {
    const user = userEvent.setup();
    const project = load(metastraProject);
    // The first row of the first section group.
    const source = project.sources[0];
    const first = gridLines(project, source, gridRows(project, source), "section", new Set()).find(
      (l) => l.kind === "row" && l.row.mapping !== undefined,
    );
    const row = first?.kind === "row" ? first.row.mapping : undefined;
    if (row === undefined) throw new Error("Metastra has rows");
    row.instanceId = "ins_nobody";
    await openProject(project);
    const grid = screen.getByRole("grid");
    const header = () =>
      within(grid)
        .getAllByRole("row")
        .find((r) => r.hasAttribute("aria-expanded"));
    grid.focus();
    await user.keyboard("{Enter}"); // Close the first group.
    expect(header()?.getAttribute("aria-expanded")).toBe("false");
    await user.click(screen.getByRole("button", { name: "Show all findings" }));
    const list = await screen.findByRole("table", { name: "All findings" });
    const go = within(list)
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-label")?.includes("ins_nobody"));
    if (go === undefined) throw new Error("the finding about ins_nobody");
    await user.click(go);
    await waitFor(() => {
      expect(header()?.getAttribute("aria-expanded")).toBe("true");
    });
    await waitFor(() => {
      expect(activeCell()?.closest('[role="row"]')?.textContent).toContain(row.code);
    });
  });

  it("lists findings that have no cell in the grid, without a link", async () => {
    const user = userEvent.setup();
    const project = load(motuProject);
    project.instances.push({
      id: "ins_orphan",
      resourceType: "Patient",
      index: 9,
      sourceId: "src_missing",
      multiplicity: { kind: "perRow" },
    });
    await openProject(project);
    await user.click(screen.getByRole("button", { name: "Show all findings" }));
    const list = await screen.findByRole("table", { name: "All findings" });
    const line = within(list)
      .getAllByRole("row")
      .find((r) => r.textContent.includes("src_missing"));
    if (line === undefined) throw new Error("the finding about src_missing");
    expect(within(line).queryByRole("button")).toBeNull();
    expect(line.textContent).toContain("role (no row uses it)");
  });

  it("shows a cell's findings in a tooltip on hover", async () => {
    const user = userEvent.setup();
    const project = load(motuProject);
    const row = project.mappings.find((m) => m.code === "R-001");
    if (row === undefined) throw new Error("MOTU has R-001");
    row.instanceId = "ins_nobody";
    await openProject(project);
    const grid = screen.getByRole("grid");
    await waitFor(() => {
      expect(
        within(grid)
          .getAllByRole("gridcell")
          .some((c) => c.getAttribute("data-severity") === "error"),
      ).toBe(true);
    });
    const cell = within(grid)
      .getAllByRole("gridcell")
      .find((c) => c.getAttribute("data-severity") === "error");
    const content = cell?.querySelector("span");
    if (!content) throw new Error("the cell's content");
    await user.hover(content);
    // Mantine opens it after its delay, through a transition that Testing Library sees as hidden:
    // look for the element itself.
    await waitFor(
      () => {
        expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("ins_nobody");
      },
      { timeout: 2000 },
    );
  });
});
