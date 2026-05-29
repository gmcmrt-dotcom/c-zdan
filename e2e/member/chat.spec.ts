import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("member chat widget", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("member");
    await page.goto("/");
    await prepareAuthenticatedPage(page);
  });

  test("opens support chat panel from floating button", async ({ page }) => {
    await page.getByRole("button", { name: "Destek sohbetini aç" }).click();
    await expect(page.getByRole("dialog", { name: "Destek sohbeti" })).toBeVisible();
    await expect(page.getByText("Destek").first()).toBeVisible();
  });

  test("closes chat panel", async ({ page }) => {
    await page.getByRole("button", { name: "Destek sohbetini aç" }).click();
    await page.getByRole("button", { name: "Kapat" }).click();
    await expect(page.getByRole("dialog", { name: "Destek sohbeti" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Destek sohbetini aç" })).toBeVisible();
  });
});
