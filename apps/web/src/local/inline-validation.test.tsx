import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../i18n";
import { mockLayout } from "../test-layout";
import type { Validator } from "../validation/use-validation";
import { patientProject, syntheticDefinitions } from "../validation/synthetic-definitions";
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

const withDefinitions: Validator = (project) => validateAll(project, syntheticDefinitions());

function renderLocal(validator: Validator) {
  render(
    <I18nextProvider i18n={createI18n()}>
      <MantineProvider>
        <LocalApp download={vi.fn()} validator={validator} />
      </MantineProvider>
    </I18nextProvider>,
  );
}

async function open(name: string, text: string) {
  await userEvent.upload(screen.getByTestId("file-input"), new File([text], name));
}

describe("inline validation in the local mode (D7)", () => {
  it("shows the boolean on Patient.name in red, with the reason, as cindermed validate", async () => {
    renderLocal(withDefinitions);
    await open("patients.json", JSON.stringify(patientProject()));
    const summary = await screen.findByTestId("validation-summary");
    await waitFor(() => {
      expect(within(summary).getByText("1 error")).toBeTruthy();
    });
    expect(
      within(summary).getByText("Checked against FHIR 4.0.1, as in cindermed validate."),
    ).toBeTruthy();
    const grid = screen.getByRole("grid");
    const rows = within(grid)
      .getAllByRole("row")
      .filter((r) => r.getAttribute("aria-rowindex") !== "1");
    const nameRow = rows.find((r) => within(r).queryByText("R-002"));
    const element = within(nameRow ?? grid).getAllByRole("gridcell")[4];
    expect(element?.textContent).toBe("name");
    expect(element?.getAttribute("aria-invalid")).toBe("true");
    expect(element?.getAttribute("data-severity")).toBe("error");
    expect(element?.getAttribute("title")).toMatch(/Patient\.name \(HumanName\)/);
    // The same column copied to Patient.active is fine.
    const activeRow = rows.find((r) => within(r).queryByText("R-001"));
    expect(
      within(activeRow ?? grid)
        .getAllByRole("gridcell")[4]
        ?.getAttribute("aria-invalid"),
    ).toBeNull();
  });

  it("validates again after each change, and the cell turns back when the row is fixed", async () => {
    const user = userEvent.setup();
    renderLocal(withDefinitions);
    await open("patients.json", JSON.stringify(patientProject()));
    const grid = await screen.findByRole("grid");
    await waitFor(() => {
      expect(
        within(grid)
          .getAllByRole("gridcell")
          .some((c) => c.getAttribute("data-severity") === "error"),
      ).toBe(true);
    });
    const cell = within(grid).getAllByText("name")[0];
    if (cell === undefined) throw new Error("the name cell");
    await user.dblClick(cell);
    const input = within(grid).getByRole("textbox", { name: "Element" });
    await user.clear(input);
    await user.type(input, "active{Enter}");
    await waitFor(() => {
      expect(within(screen.getByTestId("validation-summary")).getByText("0 errors")).toBeTruthy();
    });
    expect(
      within(grid)
        .getAllByRole("gridcell")
        .some((c) => c.getAttribute("data-severity") === "error"),
    ).toBe(false);
  });

  it("says how to get the FHIR definitions when the dev server has none", async () => {
    renderLocal((project) => validateAll(project, { message: "/fhir-index/index.json: 404" }));
    await open("patients.json", JSON.stringify(patientProject()));
    expect(
      await screen.findByText(
        "FHIR checks not run: write the definitions with cindermed fhir-index <project> --out apps/web/.fhir-index.",
      ),
    ).toBeTruthy();
  });
});
