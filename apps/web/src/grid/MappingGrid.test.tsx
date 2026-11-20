import { MantineProvider } from "@mantine/core";
import { isProjectFile, type ProjectFile, objectKey } from "@cindermed/model";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json";
import motuProject from "../../../../fixtures/fml-examples/motu/project.json";
import { createI18n } from "../i18n";
import { blobAccess } from "../storage/file-access";
import { LocalFileStore } from "../storage/local-file-store";
import type { Loaded } from "../storage/project-store";
import { mockLayout } from "../test-layout";
import { MappingGrid, ROW_HEIGHT } from "./MappingGrid";
import { gridRows } from "./rows";

/** The value, failing the test when it is missing. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing value in test");
  return value;
}

/**
 * jsdom has no layout: every element measures 0 × 0, and a virtualized grid would render no rows.
 * The scroll container's size is mocked (TanStack Virtual reads clientWidth / clientHeight), and
 * every test checks that rows are really in the page.
 */
const VIEWPORT = 4 * ROW_HEIGHT;
let restore: (() => void) | undefined;
beforeEach(() => {
  restore = mockLayout(VIEWPORT);
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

/**
 * The grid over a real LocalFileStore (download mode), as LocalApp wires it. `grouped: false`
 * removes the tables' sections, so the grid is one flat list (the D1 tests); D2 keeps them.
 */
async function renderGrid(document: unknown, { grouped = false } = {}) {
  const project = load(document);
  if (!grouped) for (const source of project.sources) delete source.sections;
  const store = new LocalFileStore(
    blobAccess({ name: "p.json", text: () => Promise.resolve(JSON.stringify(project)) }),
  );
  const loaded = await store.load();
  let latest: Loaded = loaded;
  function Harness() {
    const [state, setState] = useState(loaded);
    return (
      <MappingGrid
        project={state.project}
        versions={state.versions}
        store={store}
        onLoaded={(next) => {
          latest = next;
          setState(next);
        }}
      />
    );
  }
  render(
    <I18nextProvider i18n={createI18n()}>
      <MantineProvider>
        <Harness />
      </MantineProvider>
    </I18nextProvider>,
  );
  const grid = screen.getByRole("grid");
  return { store, grid, latest: () => latest };
}

/** Body rows actually in the page (the header row has aria-rowindex 1). */
const bodyRows = (grid: HTMLElement) =>
  within(grid)
    .getAllByRole("row")
    .filter((row) => row.getAttribute("aria-rowindex") !== "1");
const cellText = (row: HTMLElement, col: number) =>
  within(row).getAllByRole("gridcell")[col]?.textContent ?? "";

describe("MappingGrid", () => {
  it("renders the visible rows of a virtualized grid, not none and not all", async () => {
    const project = load(metastraProject);
    const { grid } = await renderGrid(project);
    const rows = bodyRows(grid);
    // Every grid row counts, but only the viewport (plus overscan) is in the page.
    const total = gridRows(project, project.sources[0]).length;
    expect(grid.getAttribute("aria-rowcount")).toBe(String(total + 1));
    expect(rows.length).toBeGreaterThanOrEqual(VIEWPORT / ROW_HEIGHT);
    expect(rows.length).toBeLessThan(total);
    expect(cellText(must(rows[0]), 0)).toMatch(/^R-\d{3}$/);
    expect(cellText(must(rows[0]), 1)).toBe(project.sources[0].columns[0].name);
  });

  it("moves with the keyboard and edits Element: Enter, type, Enter saves the row", async () => {
    const user = userEvent.setup();
    const { grid, latest } = await renderGrid(metastraProject);
    grid.focus();
    // Start on the first row's Source variable; move right three times to Element.
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    const active = () =>
      within(grid)
        .getAllByRole("gridcell")
        .find((c) => c.getAttribute("aria-selected") === "true");
    expect(active()?.getAttribute("aria-colindex")).toBe("5");
    await user.keyboard("{Enter}");
    const input = within(grid).getByRole("textbox", { name: "Element" });
    await user.clear(input);
    await user.type(input, "note.text{Enter}");
    const first = must(
      load(metastraProject).mappings.find(
        (m) => m.columnId === load(metastraProject).sources[0].columns[0].id,
      ),
    );
    await waitFor(() => {
      expect(latest().project.mappings.find((m) => m.id === first.id)?.path).toBe("note.text");
    });
    expect(latest().versions.get(objectKey("mapping", first.id))).toBe("2");
    // Enter moved down one row, still on Element.
    expect(active()?.getAttribute("aria-colindex")).toBe("5");
    expect(active()?.closest('[role="row"]')?.getAttribute("aria-rowindex")).toBe("3");
  });

  it("keeps a refused value in its cell with the reason, and Esc cancels an edit", async () => {
    const user = userEvent.setup();
    const { grid, latest } = await renderGrid(metastraProject);
    const before = latest().project;
    grid.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{Enter}");
    await user.keyboard("{Escape}");
    expect(within(grid).queryByRole("textbox")).toBeNull();
    await user.keyboard("{Enter}");
    const input = within(grid).getByRole("textbox", { name: "Element" });
    await user.clear(input);
    await user.type(input, "Not A Path{Enter}");
    await waitFor(() => {
      expect(
        within(grid)
          .getAllByRole("gridcell")
          .some((c) => c.getAttribute("aria-invalid") === "true"),
      ).toBe(true);
    });
    const refused = within(grid)
      .getAllByRole("gridcell")
      .find((c) => c.getAttribute("aria-invalid") === "true");
    expect(refused?.textContent).toBe("Not A Path");
    expect(refused?.getAttribute("title")).toMatch(/pattern/);
    expect(latest().project).toBe(before);
  });

  it("creates a row for a column without rows once Role and Element are both set", async () => {
    const user = userEvent.setup();
    const project = load(metastraProject);
    const column = project.sources[0].columns[0];
    project.mappings = project.mappings.filter((m) => m.columnId !== column.id);
    const { grid, latest } = await renderGrid(project);
    grid.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{Enter}");
    const role = must(project.instances[0]);
    await user.selectOptions(within(grid).getByRole("combobox", { name: "Role" }), role.id);
    await user.keyboard("{Tab}");
    expect(latest().project.mappings).toHaveLength(project.mappings.length);
    await user.keyboard("{Enter}");
    await user.type(
      within(grid).getByRole("textbox", { name: "Element" }),
      "identifier.value{Enter}",
    );
    await waitFor(() => {
      expect(latest().project.mappings.some((m) => m.columnId === column.id)).toBe(true);
    });
    const created = latest().project.mappings.find((m) => m.columnId === column.id);
    expect(created).toMatchObject({
      code: "R-017",
      instanceId: role.id,
      path: "identifier.value",
      transform: { kind: "copy" },
    });
  });

  it("switches between the tables of a project with several tables", async () => {
    const user = userEvent.setup();
    const project = load(motuProject);
    const { grid } = await renderGrid(project);
    const [first] = project.sources;
    const second = must(project.sources[1]);
    expect(cellText(must(bodyRows(grid)[0]), 1)).toBe(first.columns[0].name);
    await user.click(screen.getByText(second.name));
    expect(cellText(must(bodyRows(screen.getByRole("grid"))[0]), 1)).toBe(second.columns[0].name);
    expect(screen.getByRole("grid").getAttribute("aria-label")).toBe(
      `Mapping grid of table ${second.name}`,
    );
  });

  it("scrolls the active row into view when moving past the viewport", async () => {
    const user = userEvent.setup();
    const { grid } = await renderGrid(metastraProject);
    grid.focus();
    const total = gridRows(load(metastraProject), load(metastraProject).sources[0]).length;
    for (let i = 0; i < total; i += 1) await user.keyboard("{ArrowDown}");
    await act(() => new Promise((done) => setTimeout(done, 20)));
    const indexes = bodyRows(grid).map((r) => Number(r.getAttribute("aria-rowindex")));
    expect(indexes).toContain(total + 1);
    expect(indexes).not.toContain(2);
  });

  it("groups by section (D2): headers with counts, Enter closes and opens a group", async () => {
    const user = userEvent.setup();
    const { grid } = await renderGrid(metastraProject, { grouped: true });
    const groupLines = () =>
      within(grid)
        .getAllByRole("row")
        .filter((r) => r.hasAttribute("aria-expanded"));
    const first = must(groupLines()[0]);
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(first.textContent).toMatch(/^▾ Demographic data\d+ rows?$/);
    grid.focus();
    await user.keyboard("{Enter}");
    expect(must(groupLines()[0]).getAttribute("aria-expanded")).toBe("false");
    // The next line is now the next group's header.
    expect(must(bodyRows(grid)[1]).hasAttribute("aria-expanded")).toBe(true);
    await user.keyboard("{Enter}");
    expect(must(groupLines()[0]).getAttribute("aria-expanded")).toBe("true");
  });

  it("groups by role with the toggle, and edits rows inside a group", async () => {
    const user = userEvent.setup();
    const { grid, latest } = await renderGrid(metastraProject, { grouped: true });
    await user.click(screen.getByText("By role"));
    const header = must(bodyRows(grid)[0]);
    const role = must(load(metastraProject).instances[0]);
    expect(header.textContent).toContain(`${role.resourceType}[${String(role.index)}]`);
    grid.focus();
    await user.keyboard("{ArrowDown}{ArrowRight}{ArrowRight}{ArrowRight}{Enter}");
    const input = within(grid).getByRole("textbox", { name: "Element" });
    const before = input.getAttribute("value") ?? "";
    await user.clear(input);
    await user.type(input, "note.text{Enter}");
    await waitFor(() => {
      expect(
        latest().project.mappings.some((m) => m.instanceId === role.id && m.path === "note.text"),
      ).toBe(true);
    });
    expect(before).not.toBe("note.text");
  });
});
