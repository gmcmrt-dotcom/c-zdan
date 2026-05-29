import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("admin merchants", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("admin");
    await page.goto("/admin/merchants?type=commerce");
    await prepareAuthenticatedPage(page);
  });

  test("commerce merchants list loads", async ({ page }) => {
    await expect(page).toHaveURL(/\/admin\/merchants/);
    await expect(page.getByText(/Ticari|Merchant/).first()).toBeVisible();
  });

  test("finance merchants tab loads", async ({ page }) => {
    await page.goto("/admin/merchants?type=finance");
    await prepareAuthenticatedPage(page);
    await expect(page).not.toHaveURL(/\/auth/);
    await expect(page.getByText(/Finans|Merchant/).first()).toBeVisible();
  });
});
