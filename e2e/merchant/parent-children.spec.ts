import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("merchant parent owner", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("merchantParent");
    await prepareAuthenticatedPage(page);
  });

  test("/merchant/children lists child merchant", async ({ page }) => {
    await page.goto("/merchant/children");
    await prepareAuthenticatedPage(page);
    await expect(page).toHaveURL(/\/merchant\/children/);
    await expect(page.getByText("Fixture Commerce (Child)")).toBeVisible();
  });
});
