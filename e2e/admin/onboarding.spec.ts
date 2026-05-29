import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("admin onboarding", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("admin");
    await page.goto("/admin/onboarding");
    await prepareAuthenticatedPage(page);
  });

  test("onboarding page loads", async ({ page }) => {
    await expect(page).toHaveURL(/\/admin\/onboarding/);
    await expect(page.getByText(/Merchant Onboarding|Onboarding/).first()).toBeVisible();
    await expect(page.getByText("Filtre:")).toBeVisible();
  });
});
