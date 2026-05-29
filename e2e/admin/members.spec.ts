import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("admin members", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("admin");
    await page.goto("/admin/members");
    await prepareAuthenticatedPage(page);
  });

  test("members list page loads", async ({ page }) => {
    await expect(page.getByText("Üyeler").first()).toBeVisible();
  });

  test("members page shows search filter", async ({ page }) => {
    await expect(
      page.getByPlaceholder("E-posta, isim, telefon veya üyelik no..."),
    ).toBeVisible();
  });
});
