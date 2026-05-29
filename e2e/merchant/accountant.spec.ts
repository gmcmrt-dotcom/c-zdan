import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("merchant accountant role", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("merchantAccountant");
    await page.goto("/merchant");
    await prepareAuthenticatedPage(page);
  });

  test("accountant can open dashboard", async ({ page }) => {
    await expect(page).toHaveURL(/\/merchant/);
    await expect(page.getByRole("link", { name: "Dashboard" }).first()).toBeVisible();
  });

  test("accountant cannot see settings nav", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Ayarlar" })).toHaveCount(0);
  });

  test("accountant settings page shows owner-only message", async ({ page }) => {
    await page.goto("/merchant/settings");
    await prepareAuthenticatedPage(page);
    await expect(page.getByText(/iş yeri sahibine/i)).toBeVisible();
  });
});
