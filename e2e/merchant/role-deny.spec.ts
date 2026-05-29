import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("merchant readonly role", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("merchantReadonly");
    await page.goto("/merchant");
    await prepareAuthenticatedPage(page);
  });

  test("readonly can open dashboard", async ({ page }) => {
    await expect(page).toHaveURL(/\/merchant/);
  });

  test("readonly settings page blocked", async ({ page }) => {
    await page.goto("/merchant/settings");
    await prepareAuthenticatedPage(page);
    await expect(page.getByText(/iş yeri sahibine/i)).toBeVisible();
  });

  test("readonly users page blocked or hidden", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Kullanıcılar" })).toHaveCount(0);
  });
});
