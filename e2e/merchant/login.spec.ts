import { test, expect } from "@playwright/test";
import { ACCOUNTS, loginAs } from "../helpers/auth";
import { assertAppReachable, ensureTurkishLocale } from "../helpers/ui";

test.describe("merchant auth", () => {
  test.beforeEach(async ({ page }) => {
    await assertAppReachable(page);
  });

  test("logs in as merchant owner", async ({ page }) => {
    await loginAs(page, "merchant");
    await expect(page).not.toHaveURL(/\/auth$/);
  });

  test("auth form ready for merchant credentials", async ({ page }) => {
    await ensureTurkishLocale(page);
    await page.goto("/auth");
    await page.locator("#li-email").fill(ACCOUNTS.merchant.email);
    await expect(page.locator("#li-pw")).toBeVisible();
  });
});
