import { MantineProvider } from "@mantine/core";
import { type MappingRow, type ProjectFile, isProjectFile } from "@cindermed/model";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json";
import { createI18n } from "../i18n";
import { LocalApp } from "../local/LocalApp";
import { mockLayout } from "../test-layout";
import type { Validator } from "../validation/use-validation";
import { syntheticDefinitions } from "../validation/synthetic-definitions";
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

const REBUILT = ["R-003", "R-010", "R-013"];

/** Metastra with three rows back to a plain copy, as the grid creates them. */
function metastraWithCopies(): ProjectFile {
  const project = load(metastraProject);
  return {
    ...project,
    mappings: project.mappings.map((m): MappingRow => {
      if (!REBUILT.includes(m.code)) return m;
      const row: MappingRow = { ...m, transform: { kind: "copy" } };
      delete row.repeat;
      return row;
    }),
  };
}

const withoutDefinitions: Validator = (p) =>
  validateAll(p, { message: "no definitions in this test" });
const withDefinitions: Validator = (p) => validateAll(p, syntheticDefinitions());

/** A patient table: given → name.text, flag → active (FHIR definitions: synthetic-definitions). */
function namesProject(): ProjectFile {
  return {
    formatVersion: "1.4.0",
    project: {
      id: "prj_names1",
      name: "Names",
      fhirVersion: "4.0.1",
      canonicalBase: "https://cindermed.org/fhir/n",
    },
    sources: [
      {
        id: "src_names1",
        name: "Names",
        columns: [
          { id: "col_given", name: "given", dataType: "string" },
          { id: "col_family", name: "family", dataType: "string" },
          { id: "col_flag", name: "flag", dataType: "boolean" },
        ],
      },
    ],
    instances: [
      {
        id: "ins_pat001",
        resourceType: "Patient",
        index: 0,
        sourceId: "src_names1",
        multiplicity: { kind: "perRow" },
      },
    ],
    mappings: [
      {
        id: "map_given",
        code: "R-001",
        columnId: "col_given",
        instanceId: "ins_pat001",
        path: "name.text",
        transform: { kind: "copy" },
      },
      {
        id: "map_flag1",
        code: "R-002",
        columnId: "col_flag",
        instanceId: "ins_pat001",
        path: "active",
        transform: { kind: "copy" },
      },
    ],
    valueMaps: [],
  };
}

async function open(project: ProjectFile, validator: Validator = withoutDefinitions) {
  const download = vi.fn<(name: string, text: string) => void>();
  render(
    <I18nextProvider i18n={createI18n()}>
      <MantineProvider>
        <LocalApp download={download} validator={validator} />
      </MantineProvider>
    </I18nextProvider>,
  );
  await userEvent.upload(
    screen.getByTestId("file-input"),
    new File([JSON.stringify(project)], "metastra.json"),
  );
  return { grid: await screen.findByRole("grid"), download };
}

/** A cell of a row, by the row's code and the column's position (Transform is 5, Values 6). */
function cell(grid: HTMLElement, code: string, column: number): HTMLElement {
  const row = within(grid)
    .getAllByRole("row")
    .find((r) => within(r).queryAllByRole("gridcell")[0]?.textContent === code);
  const found = row === undefined ? undefined : within(row).getAllByRole("gridcell")[column];
  if (found === undefined) throw new Error(`no cell ${code}/${String(column)}`);
  return found;
}

async function saved(download: ReturnType<typeof vi.fn<(name: string, text: string) => void>>) {
  await userEvent.click(screen.getByRole("button", { name: "Download project" }));
  const [, text] = download.mock.calls.at(-1) ?? [];
  return load(JSON.parse(text ?? "{}"));
}

describe("the transform editor (D5)", () => {
  it("sets a conversion, a quantity with a unit column and a value map with repeat, as in Metastra", async () => {
    const user = userEvent.setup();
    const { grid, download } = await open(metastraWithCopies());

    // R-003: Enter on Transform opens the editor; the date format comes from the column.
    await user.click(cell(grid, "R-003", 5));
    await user.keyboard("{Enter}");
    let dialog = await screen.findByRole("dialog", {
      name: "Transform of R-003 (patient_birthdate)",
    });
    await user.selectOptions(within(dialog).getByLabelText("Transform"), "cast");
    await user.selectOptions(within(dialog).getByLabelText("Convert to"), "date");
    expect(within(dialog).getByLabelText(/Format in the data file/)).toHaveProperty(
      "value",
      "dd/MM/yyyy",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(cell(grid, "R-003", 5).textContent).toBe("Conversion");

    // R-010: a double-click on Values; the unit is read from another column.
    await user.dblClick(cell(grid, "R-010", 6));
    dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Transform"), "quantity");
    await user.click(within(dialog).getByText("Unit from a column"));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("Choose the column that holds the unit.")).toBeTruthy();
    await user.selectOptions(within(dialog).getByLabelText("Unit column"), "col_hb_unit");
    await user.selectOptions(within(dialog).getByLabelText(/^Unit value map/), "vm_hb_unit");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(cell(grid, "R-010", 6).textContent).toBe("unit: obs_bloodt_hb_spec");

    // R-013: a multiple-choice column, one bodySite per level.
    await user.dblClick(cell(grid, "R-013", 5));
    dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Transform"), "valueMap");
    await user.selectOptions(within(dialog).getByLabelText("Value map"), "vm_spine_level");
    await user.click(within(dialog).getByLabelText(/One repetition per selected value/));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    // The rows equal the fixture's.
    const project = await saved(download);
    const fixture = load(metastraProject);
    for (const code of REBUILT)
      expect(project.mappings.find((m) => m.code === code)).toEqual(
        fixture.mappings.find((m) => m.code === code),
      );
  });

  it("copies a unit text from a column, with its code system, and opens it again as it was (#108)", async () => {
    const user = userEvent.setup();
    const { grid, download } = await open(load(metastraProject));

    await user.dblClick(cell(grid, "R-010", 6));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Unit text from a column"));
    // The unit column stays; the value map gives way to the optional code system.
    expect(within(dialog).queryByLabelText(/^Unit value map/)).toBeNull();
    await user.type(
      within(dialog).getByLabelText(/^Unit code system/),
      "http://example.org/fhir/units",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(cell(grid, "R-010", 6).textContent).toBe("unit: obs_bloodt_hb_spec");
    expect(cell(grid, "R-010", 5).getAttribute("aria-invalid")).not.toBe("true");

    await user.dblClick(cell(grid, "R-010", 6));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/^Unit code system/)).toHaveProperty(
      "value",
      "http://example.org/fhir/units",
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    const project = await saved(download);
    expect(project.mappings.find((m) => m.code === "R-010")?.transform).toEqual({
      kind: "quantity",
      unitColumnId: "col_hb_unit",
      unitSystem: "http://example.org/fhir/units",
    });
  });

  it("adds a constant row, and says why a reference or an empty line has no editor here", async () => {
    const user = userEvent.setup();
    const { grid, download } = await open(load(metastraProject));

    await user.dblClick(cell(grid, "R-005", 5));
    expect(
      await screen.findByText("References are set with the roles' context, in a later version."),
    ).toBeTruthy();

    // A column with no row yet: its line has no code.
    await user.dblClick(cell(grid, "", 5));
    expect(
      await screen.findByText(
        "Choose the row's role and element first: the transform is set on a saved row.",
      ),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add constant row" }));
    const dialog = await screen.findByRole("dialog", { name: "New constant row" });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("Choose the role.")).toBeTruthy();
    await user.selectOptions(within(dialog).getByLabelText("Role"), "ins_patient0");
    await user.type(within(dialog).getByLabelText(/^Element/), "identifier.system");
    await user.selectOptions(within(dialog).getByLabelText("Value type"), "uri");
    await user.type(
      within(dialog).getByLabelText(/^Value \(uri\)/),
      "https://example.org/fhir/ids/patient",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(within(grid).getByText("https://example.org/fhir/ids/patient")).toBeTruthy();
    });

    const project = await saved(download);
    const added = project.mappings.at(-1);
    expect(added).toMatchObject({
      code: "R-017",
      instanceId: "ins_patient0",
      path: "identifier.system",
      transform: {
        kind: "constant",
        value: { type: "uri", value: "https://example.org/fhir/ids/patient" },
      },
    });
    expect(added).not.toHaveProperty("columnId");
  });

  it("offers concatenation again, and the grid reports no error for it (#98)", async () => {
    const user = userEvent.setup();
    const { grid, download } = await open(namesProject(), withDefinitions);
    const summary = await screen.findByTestId("validation-summary");
    const clean = () => {
      expect(within(summary).getByText("0 errors")).toBeTruthy();
      expect(within(summary).getByText("0 warnings")).toBeTruthy();
      expect(within(summary).getByText(/Checked against FHIR 4\.0\.1/)).toBeTruthy();
    };
    await waitFor(clean);

    // R-001 (given → name.text) becomes given + family.
    await user.dblClick(cell(grid, "R-001", 5));
    const dialog = await screen.findByRole("dialog");
    const kinds = within(within(dialog).getByLabelText<HTMLSelectElement>("Transform"))
      .getAllByRole("option")
      .map((o) => o.getAttribute("value"));
    expect(kinds).toContain("concat");
    await user.selectOptions(within(dialog).getByLabelText("Transform"), "concat");
    await user.click(within(dialog).getByLabelText("family"));
    expect(within(dialog).getByText("Joined in this order: given + family")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(cell(grid, "R-001", 5).textContent).toBe("Concatenation");

    // The FHIR checks ran on it and found nothing: no error in the summary or the row's cells.
    await waitFor(clean);
    expect(
      within(grid)
        .getAllByRole("gridcell")
        .filter((c) => c.getAttribute("aria-invalid") === "true"),
    ).toEqual([]);
    const project = await saved(download);
    expect(project.mappings.find((m) => m.code === "R-001")?.transform).toEqual({
      kind: "concat",
      columnIds: ["col_given", "col_family"],
    });

    // The same checks still catch a concatenation on a boolean element (Patient.active).
    await user.dblClick(cell(grid, "R-002", 5));
    const second = await screen.findByRole("dialog");
    await user.selectOptions(within(second).getByLabelText("Transform"), "concat");
    await user.click(within(second).getByLabelText("given"));
    await user.click(within(second).getByRole("button", { name: "Save" }));
    // Two errors: a boolean column cannot be joined, and Patient.active is not a string.
    await waitFor(() => {
      expect(within(summary).getByText("2 errors")).toBeTruthy();
    });
    expect(cell(grid, "R-002", 5).getAttribute("aria-invalid")).toBe("true");
  });
});
