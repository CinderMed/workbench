import { MantineProvider } from "@mantine/core";
import { type ProjectFile, isProjectFile } from "@cindermed/model";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json";
import { createI18n } from "../i18n";
import { LocalApp } from "../local/LocalApp";
import { mockLayout } from "../test-layout";
import { validateAll } from "../validation/validate";

let restore: (() => void) | undefined;
beforeEach(() => {
  restore = mockLayout(1600);
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

async function open() {
  const download = vi.fn<(name: string, text: string) => void>();
  render(
    <I18nextProvider i18n={createI18n()}>
      <MantineProvider>
        <LocalApp
          download={download}
          validator={(p) => validateAll(p, { message: "no definitions in this test" })}
        />
      </MantineProvider>
    </I18nextProvider>,
  );
  await userEvent.upload(
    screen.getByTestId("file-input"),
    new File([JSON.stringify(metastraProject)], "metastra.json"),
  );
  const grid = await screen.findByRole("grid");
  const saved = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Download project" }));
    const [, text] = download.mock.calls.at(-1) ?? [];
    return load(JSON.parse(text ?? "{}"));
  };
  return { grid, saved };
}

/** The codes of the data rows on screen, and of those selected. */
const shownCodes = (grid: HTMLElement) =>
  within(grid)
    .getAllByRole("row")
    .flatMap((r) => {
      const code = within(r).queryAllByRole("gridcell")[0]?.textContent ?? "";
      return /^R-\d+$/.test(code) ? [code] : [];
    });
const selectedCodes = (grid: HTMLElement) =>
  within(grid)
    .getAllByRole("row")
    .filter((r) => r.getAttribute("aria-selected") === "true")
    .map((r) => within(r).getAllByRole("gridcell")[0]?.textContent);
const rowOf = (grid: HTMLElement, code: string) => {
  const row = within(grid)
    .getAllByRole("row")
    .find((r) => within(r).queryAllByRole("gridcell")[0]?.textContent === code);
  if (row === undefined) throw new Error(code);
  return row;
};

describe("filters and bulk actions (D8)", () => {
  it("filters by role, selects what is shown and sets its status in one batch", async () => {
    const user = userEvent.setup();
    const { grid, saved } = await open();
    await user.selectOptions(screen.getByLabelText("Role"), "ins_patient0");
    expect(shownCodes(grid).sort()).toEqual(["R-001", "R-002", "R-003"]);
    await user.click(screen.getByRole("button", { name: "Select all shown" }));
    expect(screen.getByText("3 rows selected")).toBeTruthy();
    expect(selectedCodes(grid).sort()).toEqual(["R-001", "R-002", "R-003"]);
    // They are approved already: nothing to write.
    await user.selectOptions(screen.getByLabelText("Set status…"), "approved");
    expect(
      await screen.findByText("The selected rows already have it: nothing to change."),
    ).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Set status…"), "toReview");
    expect(await screen.findByText("3 rows updated.")).toBeTruthy();

    // A filter on the new status shows them; clearing the filters shows every line again.
    await user.selectOptions(screen.getByLabelText("Status"), "toReview");
    // The filters combine: patient rows to review. Without the role, R-006 and R-007 too.
    expect(shownCodes(grid).sort()).toEqual(["R-001", "R-002", "R-003"]);
    await user.selectOptions(screen.getByLabelText("Role"), "");
    expect(shownCodes(grid).sort()).toEqual(["R-001", "R-002", "R-003", "R-006", "R-007"]);
    expect(screen.queryByText(/rows? selected/)).toBeNull(); // A new filter clears the selection.
    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    const project = await saved();
    const fixture = load(metastraProject);
    for (const row of project.mappings) {
      const before = fixture.mappings.find((m) => m.id === row.id);
      if (["R-001", "R-002", "R-003"].includes(row.code))
        expect(row).toEqual({ ...before, review: { ...before?.review, status: "toReview" } });
      else expect(row).toEqual(before);
    }
  });

  it("selects with Space, Ctrl-click and Shift-click, and sets their role", async () => {
    const user = userEvent.setup();
    const { grid, saved } = await open();
    // Rows in the order on screen (grouped by section).
    const [a, b, c] = shownCodes(grid);
    if (a === undefined || b === undefined || c === undefined) throw new Error("rows");
    const cellOf = (code: string) => {
      const found = within(rowOf(grid, code)).getAllByRole("gridcell")[1];
      if (found === undefined) throw new Error(code);
      return found;
    };
    // Space on the active row, after a plain click on it.
    await user.click(cellOf(a));
    await user.keyboard(" ");
    expect(selectedCodes(grid)).toEqual([a]);
    // Shift-click two rows down selects the three; Ctrl-click takes the middle one out.
    await user.keyboard("{Shift>}");
    await user.click(cellOf(c));
    await user.keyboard("{/Shift}");
    expect(selectedCodes(grid)).toEqual([a, b, c]);
    await user.keyboard("{Control>}");
    await user.click(cellOf(b));
    await user.keyboard("{/Control}");
    expect(selectedCodes(grid)).toEqual([a, c]);

    await user.selectOptions(screen.getByLabelText("Set role…"), "ins_proc0");
    expect(await screen.findByText("2 rows updated.")).toBeTruthy();
    const project = await saved();
    const fixture = load(metastraProject);
    const roleIn = (p: ProjectFile, code: string) =>
      p.mappings.find((m) => m.code === code)?.instanceId;
    expect([roleIn(project, a), roleIn(project, c)]).toEqual(["ins_proc0", "ins_proc0"]);
    expect(roleIn(project, b)).toBe(roleIn(fixture, b));
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    await waitFor(() => {
      expect(selectedCodes(grid)).toEqual([]);
    });
  });
});
