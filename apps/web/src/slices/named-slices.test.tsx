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
import { painProject, syntheticDefinitions } from "../validation/synthetic-definitions";
import { validateAll } from "../validation/validate";
import { withoutSlice } from "./slices";

let restore: (() => void) | undefined;
beforeEach(() => {
  restore = mockLayout(400);
});
afterEach(() => {
  cleanup();
  restore?.();
});

async function openPain() {
  const synthetic = syntheticDefinitions();
  const download = vi.fn<(name: string, text: string) => void>();
  render(
    <I18nextProvider i18n={createI18n()}>
      <MantineProvider>
        <LocalApp
          download={download}
          validator={(p) => validateAll(p, synthetic)}
          definitions={() => Promise.resolve(syntheticDefinitions())}
        />
      </MantineProvider>
    </I18nextProvider>,
  );
  await userEvent.upload(
    screen.getByTestId("file-input"),
    new File([JSON.stringify(painProject())], "pain.json"),
  );
  return { grid: await screen.findByRole("grid"), download };
}

describe("named slices in the path picker (D4)", () => {
  it("names a repetition of component, writes the row to it, and saves the Metastra slice", async () => {
    const user = userEvent.setup();
    const { grid, download } = await openPain();
    grid.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{Enter}"); // Element of R-001.
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("tree");
    expect(within(dialog).getByTestId("picker-selected").textContent).toBe("component");
    // Only a repeating element can be named: not offered on status.
    await user.click(
      within(dialog).getByRole("button", { name: "Name a repetition of component" }),
    );

    const form = within(dialog).getByRole("form", { name: "New named slice of component" });
    expect(within(form).getByLabelText("Told apart by")).toHaveProperty("value", "code");
    await user.type(within(form).getByLabelText(/^Name/), "1st");
    await user.type(within(form).getByLabelText(/^Code system/), "http://snomed.info/sct");
    await user.type(within(form).getByLabelText(/^Code(?! system)/), "1284852002");
    await user.click(within(form).getByRole("button", { name: "Create slice" }));
    expect(
      await within(form).findByText(
        "The name can hold letters, digits and '-', and starts with a letter.",
      ),
    ).toBeTruthy();
    await user.clear(within(form).getByLabelText(/^Name/));
    await user.type(within(form).getByLabelText(/^Name/), "nrs");
    await user.click(within(form).getByRole("button", { name: "Create slice" }));

    // The new slice shows open and selected under component, with its children.
    await waitFor(() => {
      expect(within(dialog).getByTestId("picker-selected").textContent).toBe("component[nrs]");
    });
    const tree = within(dialog).getByRole("tree");
    const names = () =>
      within(tree)
        .getAllByRole("treeitem")
        .map((i) => i.textContent.replace(/[▸▾]/g, ""));
    expect(names()).toContain("component[nrs]0..1BackboneElement");
    expect(names()).toContain("valueInteger0..1integer");
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}"); // code, then valueInteger.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(within(grid).getByText("component[nrs].valueInteger")).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Download project" }));
    const [, text] = download.mock.calls[0] ?? [];
    const saved = JSON.parse(text ?? "{}") as unknown;
    if (!isProjectFile(saved)) throw new Error("not a project");
    const project: ProjectFile = saved;
    const [slice] = project.instances[0]?.slices ?? [];
    const expected = metastraProject.instances.flatMap((i) => i.slices ?? [])[0];
    expect(slice?.id).toMatch(/^slc_/);
    expect({ ...slice, id: expected?.id }).toEqual(expected);
    expect(project.mappings[0]?.path).toBe("component[nrs].valueInteger");
    // The slice is declared and resolves: no finding on it or on the row's path.
    const results = await validateAll(project, syntheticDefinitions());
    expect(results.results.filter((r) => r.severity === "error")).toEqual([]);
    const undeclared = await validateAll(
      {
        ...project,
        instances: project.instances.map((role) =>
          (role.slices ?? []).reduce((r, slice) => withoutSlice(r, slice.id), role),
        ),
      },
      syntheticDefinitions(),
    );
    expect(undeclared.results.map((r) => r.code)).toContain("SLICE_NOT_DECLARED");
  });

  it("does not offer a new slice on an element that does not repeat", async () => {
    const user = userEvent.setup();
    const { grid } = await openPain();
    grid.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{Enter}");
    const dialog = await screen.findByRole("dialog");
    const tree = await within(dialog).findByRole("tree");
    tree.focus();
    await user.keyboard("{ArrowUp}{ArrowUp}"); // From component to status.
    expect(within(dialog).getByTestId("picker-selected").textContent).toBe("status");
    expect(within(dialog).queryByRole("button", { name: /Name a repetition/ })).toBeNull();
  });
});
