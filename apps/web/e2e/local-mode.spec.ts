// Smoke test of the local mode (#187): load Metastra, break a path, and see the real worker and
// the real FHIR index turn the cell red, with PATH_NOT_FOUND in the details bar.
import { expect, test } from "@playwright/test";
import { metastraProject } from "./global-setup";

test("a broken path turns its cell red, with the reason in the details bar", async ({ page }) => {
  // Any error in the browser console (React warnings, failed requests) fails the test.
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("Local mode · this computer only")).toBeVisible();
  await page.getByTestId("file-input").setInputFiles(metastraProject);

  const summary = page.getByTestId("validation-summary");
  await expect(summary).toContainText("Checked against FHIR 4.0.1", { timeout: 60_000 });
  await expect(summary).toContainText("0 errors");

  // The first row of the first section group (line 2 is the group's header).
  const grid = page.getByRole("grid");
  const row = grid.locator('[role="row"][aria-rowindex="3"]');
  const element = row.getByRole("gridcell").nth(4);
  await expect(element).not.toHaveAttribute("data-severity", "error");
  const code = (await row.getByRole("gridcell").nth(0).textContent()) ?? "";
  expect(code).toMatch(/^R-\d{3}$/);

  // Enter and double-click open the path picker; F2 types the path.
  await element.click();
  await page.keyboard.press("F2");
  const input = grid.getByRole("textbox", { name: "Element" });
  await input.fill("notAnElement");
  await input.press("Enter");

  await expect(element).toHaveAttribute("data-severity", "error", { timeout: 30_000 });
  await expect(summary).toContainText("1 error");
  await element.click();
  const details = page.getByTestId("cell-details");
  await expect(details).toContainText(`${code} · Element`);
  await expect(details).toContainText("PATH_NOT_FOUND");

  // The path picker reads the same real definitions on the page: Enter opens the role's tree.
  await page.keyboard.press("Enter");
  const picker = page.getByRole("dialog");
  await expect(picker.getByRole("tree")).toBeVisible({ timeout: 30_000 });
  expect(await picker.getByRole("treeitem").count()).toBeGreaterThan(5);
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();

  expect(consoleErrors).toEqual([]);
});
