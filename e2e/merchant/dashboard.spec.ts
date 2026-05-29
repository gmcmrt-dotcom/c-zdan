import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("merchant dashboard", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("merchant");
    await page.goto("/merchant");
    await prepareAuthenticatedPage(page);
  });

  test("/merchant loads dashboard", async ({ page }) => {
    await expect(page).toHaveURL(/\/merchant\/?(\?.*)?$/);
    await expect(page.getByRole("link", { name: "Dashboard" }).first()).toBeVisible();
  });

  test("sidebar includes transactions nav item", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Üye işlemleri" })).toBeVisible();
  });
});
