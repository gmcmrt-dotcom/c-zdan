import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("merchant settlement", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("merchant");
    await page.goto("/merchant/settlement");
    await prepareAuthenticatedPage(page);
  });

  test("settlement page loads", async ({ page }) => {
    await expect(page).toHaveURL(/\/merchant\/settlement/);
    await expect(page.getByText(/Settlement|Mutabakat|Ödeme/i).first()).toBeVisible();
  });
});
