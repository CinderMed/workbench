import { MantineProvider } from "@mantine/core";
import { isProjectFile, type ProjectFile } from "@cindermed/model";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json";
import { createI18n } from "../i18n";
import { blobAccess } from "../storage/file-access";
import { LocalFileStore } from "../storage/local-file-store";
import type { Loaded } from "../storage/project-store";
import { RolesPanel } from "./RolesPanel";

afterEach(cleanup);

const load = (document: unknown): ProjectFile => {
  const copy = JSON.parse(JSON.stringify(document)) as unknown;
  if (!isProjectFile(copy)) throw new Error("not a project");
  return copy;
};

/** The Metastra project as `cindermed init` leaves it: its table and columns, no roles or rows. */
function initLike(withRowKey: boolean): ProjectFile {
  const project = load(metastraProject);
  const source = { ...project.sources[0] };
  if (!withRowKey) delete source.rowKey;
  return { ...project, sources: [source], instances: [], mappings: [], valueMaps: [] };
}

async function renderPanel(project: ProjectFile) {
  const store = new LocalFileStore(
    blobAccess({ name: "p.json", text: () => Promise.resolve(JSON.stringify(project)) }),
    () => "abcdefghij",
  );
  const loaded = await store.load();
  let latest: Loaded = loaded;
  function Harness() {
    const [state, setState] = useState(loaded);
    return (
      <RolesPanel
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
  return { latest: () => latest };
}

async function fillRole(type: string, label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add role" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText(/Resource type/), type);
  await user.type(within(dialog).getByLabelText("Label"), label);
  return { user, dialog };
}

describe("RolesPanel", () => {
  it("creates the first role of a project from cindermed init, with the defaults", async () => {
    const { latest } = await renderPanel(initLike(true));
    expect(screen.getByText("No roles yet: add one to start mapping.")).toBeTruthy();
    const { user, dialog } = await fillRole("Patient", "patient");
    expect(within(dialog).getByText("patient0-<patient_id>")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(latest().project.instances).toHaveLength(1);
    });
    expect(latest().project.instances[0]).toEqual({
      id: "ins_abcdefghij",
      resourceType: "Patient",
      index: 0,
      sourceId: "src_firstoverview",
      label: "patient",
      multiplicity: { kind: "perRow" },
      idRule: { parts: [{ literal: "patient0" }, { columnId: "col_patient_id" }] },
    });
    expect(screen.getByRole("table", { name: "Roles" })).toBeTruthy();
    expect(screen.getByText("Patient[0] · patient")).toBeTruthy();
  });

  it("gives the next index of a type, and no id rule without a row key", async () => {
    const project = initLike(false);
    project.instances = [
      {
        id: "ins_obs000",
        resourceType: "Observation",
        index: 0,
        sourceId: project.sources[0].id,
        multiplicity: { kind: "perRow" },
      },
    ];
    const { latest } = await renderPanel(project);
    const { user, dialog } = await fillRole("Observation", "pain");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Index").value).toBe("1");
    expect(within(dialog).getByText(/The table has no row key yet/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(latest().project.instances).toHaveLength(2);
    });
    expect(latest().project.instances[1]).not.toHaveProperty("idRule");
    expect(latest().project.instances[1]?.index).toBe(1);
  });

  it("keeps the form open with the reason when the project refuses the role", async () => {
    const { latest } = await renderPanel(initLike(true));
    const { user, dialog } = await fillRole("patient", "lower case");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText(/resourceType/)).toBeTruthy();
    expect(latest().project.instances).toHaveLength(0);
    expect(within(dialog).getByLabelText<HTMLInputElement>(/Resource type/).value).toBe("patient");
  });

  it("edits a role, and its default id rule follows the new index", async () => {
    const { latest } = await renderPanel(initLike(true));
    const { user, dialog } = await fillRole("Observation", "pain");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(latest().project.instances).toHaveLength(1);
    });
    await user.click(screen.getByRole("button", { name: "Edit Observation[0] · pain" }));
    const edit = await screen.findByRole("dialog");
    const index = within(edit).getByLabelText("Index");
    await user.clear(index);
    await user.type(index, "3");
    await user.clear(within(edit).getByLabelText("Label"));
    await user.click(within(edit).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(latest().project.instances[0]?.index).toBe(3);
    });
    expect(latest().project.instances[0]).not.toHaveProperty("label");
    expect(latest().project.instances[0]?.idRule?.parts[0]).toEqual({ literal: "observation3" });
  });

  it("deletes a role after confirming, even when rows use it", async () => {
    const project = load(metastraProject);
    const role = project.instances[0];
    if (role === undefined) throw new Error("metastra has roles");
    const { latest } = await renderPanel(project);
    const user = userEvent.setup();
    const name =
      role.label === undefined
        ? `${role.resourceType}[${String(role.index)}]`
        : `${role.resourceType}[${String(role.index)}] · ${role.label}`;
    await user.click(screen.getByRole("button", { name: `Delete ${name}` }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/rows? uses? this role: (it|they) will show an error/),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(latest().project.instances.some((i) => i.id === role.id)).toBe(false);
    });
    expect(latest().project.mappings.some((m) => m.instanceId === role.id)).toBe(true);
  });
});
