import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("admin dashboard", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("admin");
    await page.goto("/admin");
    await prepareAuthenticatedPage(page);
  });

  test("/admin loads panel dashboard", async ({ page }) => {
    await expect(page).toHaveURL(/\/admin\/?(\?.*)?$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("shows date range filters on dashboard", async ({ page }) => {
    await expect(page.getByText("Bugün").first()).toBeVisible();
    await expect(page.getByText("Son 7 gün").first()).toBeVisible();
  });
});
