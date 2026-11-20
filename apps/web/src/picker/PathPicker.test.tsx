import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../i18n";
import { LocalApp } from "../local/LocalApp";
import { mockLayout } from "../test-layout";
import type { BrowserDefinitions } from "../validation/index-fetch";
import { patientProject, syntheticDefinitions } from "../validation/synthetic-definitions";
import { validateAll } from "../validation/validate";

let restore: (() => void) | undefined;
beforeEach(() => {
  restore = mockLayout(400);
});
afterEach(() => {
  cleanup();
  restore?.();
});

async function openPatients(definitions: () => Promise<BrowserDefinitions>) {
  const synthetic = syntheticDefinitions();
  render(
    <I18nextProvider i18n={createI18n()}>
      <MantineProvider>
        <LocalApp
          download={vi.fn()}
          validator={(p) => validateAll(p, synthetic)}
          definitions={definitions}
        />
      </MantineProvider>
    </I18nextProvider>,
  );
  await userEvent.upload(
    screen.getByTestId("file-input"),
    new File([JSON.stringify(patientProject())], "patients.json"),
  );
  return screen.findByRole("grid");
}

describe("the path picker (D3)", () => {
  it("opens from Element with Enter, opens a datatype, searches, and saves the chosen path", async () => {
    const user = userEvent.setup();
    const grid = await openPatients(() => Promise.resolve(syntheticDefinitions()));
    grid.focus();
    // R-002 (Patient.name): the second row; Element is the fifth column.
    await user.keyboard("{ArrowDown}{ArrowRight}{ArrowRight}{ArrowRight}{Enter}");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Element for flag")).toBeTruthy();
    const tree = await within(dialog).findByRole("tree");
    // It starts on the row's current path.
    expect(within(dialog).getByTestId("picker-selected").textContent).toBe("name");
    const items = () => within(tree).getAllByRole("treeitem");
    expect(items().map((i) => i.getAttribute("aria-level"))).toEqual(["1", "1", "1"]);
    expect(items()[1]?.textContent).toMatch(/^▸name0\.\.\*HumanName$/);
    tree.focus();
    await user.keyboard("{ArrowRight}"); // Open name (HumanName).
    await waitFor(() => {
      expect(items().map((i) => i.textContent)).toContain("family0..1string");
    });
    await user.type(within(dialog).getByLabelText("Search by name"), "fam");
    expect(items().map((i) => i.textContent.replace(/[▸▾]/g, ""))).toEqual([
      "name0..*HumanName",
      "family0..1string",
    ]);
    await user.keyboard("{Enter}"); // From the search box to the tree.
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(within(grid).getByText("name.family")).toBeTruthy();
    });
  });

  it("keeps F2 for typing a path, and says why the picker cannot open", async () => {
    const user = userEvent.setup();
    const grid = await openPatients(() =>
      Promise.resolve({ message: "/fhir-index/index.json: 404" }),
    );
    grid.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{F2}");
    expect(within(grid).getByRole("textbox", { name: "Element" })).toBeTruthy();
    await user.keyboard("{Escape}{Enter}");
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("/fhir-index/index.json: 404")).toBeTruthy();
  });

  it("greys the elements the row cannot be written to, and says what the others need", async () => {
    const user = userEvent.setup();
    const grid = await openPatients(() => Promise.resolve(syntheticDefinitions()));
    grid.focus();
    // R-002 copies the boolean column flag: the picker opens on name, a HumanName.
    await user.keyboard("{ArrowDown}{ArrowRight}{ArrowRight}{ArrowRight}{Enter}");
    const dialog = await screen.findByRole("dialog");
    const tree = await within(dialog).findByRole("tree");
    const item = (name: string) =>
      within(tree)
        .getAllByRole("treeitem")
        .find((i) => i.textContent.replace(/[▸▾]/g, "").startsWith(name));
    expect(item("name")?.getAttribute("aria-disabled")).toBe("true");
    expect(item("active")?.getAttribute("aria-disabled")).toBeNull();
    expect(within(dialog).getByTestId("picker-fit").textContent).toMatch(
      /^The row cannot be written here: R-002: column flag \(boolean\) cannot be copied to Patient\.name/,
    );
    expect(within(dialog).getByRole("button", { name: "Use this element" })).toHaveProperty(
      "disabled",
      true,
    );
    tree.focus();
    await user.keyboard("{Enter}"); // Not chosen: the dialog stays.
    expect(screen.getByRole("dialog")).toBeTruthy();
    // name.family takes the flag once converted: it can be chosen, with the reason.
    await user.keyboard("{ArrowRight}");
    await waitFor(() => {
      expect(item("family")).toBeDefined();
    });
    await user.keyboard("{ArrowDown}");
    expect(within(dialog).getByTestId("picker-selected").textContent).toBe("name.family");
    expect(within(dialog).getByTestId("picker-fit").textContent).toBe(
      "The row can be written here with another transform: Conversion. Set it in the Transform cell after choosing.",
    );
    await user.keyboard("{ArrowUp}{ArrowUp}"); // active: fits, no note.
    expect(within(dialog).getByTestId("picker-selected").textContent).toBe("active");
    expect(within(dialog).queryByTestId("picker-fit")).toBeNull();
  });
});
