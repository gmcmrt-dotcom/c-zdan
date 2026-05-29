import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("admin permissions", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("admin");
    await page.goto("/admin/permissions");
    await prepareAuthenticatedPage(page);
  });

  test("permissions matrix page loads", async ({ page }) => {
    await expect(page.getByText("Yetkiler").first()).toBeVisible();
    await expect(page.getByText(/Modül|Panel|Üyeler/).first()).toBeVisible();
  });
});
