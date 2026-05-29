import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("merchant settings", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("merchant");
    await page.goto("/merchant/settings");
    await prepareAuthenticatedPage(page);
  });

  test("owner can open settings page", async ({ page }) => {
    await expect(page).toHaveURL(/\/merchant\/settings/);
    await expect(page.getByText("Ayarlar").first()).toBeVisible();
    await expect(page.getByText("Signing Secret").first()).toBeVisible();
  });
});
