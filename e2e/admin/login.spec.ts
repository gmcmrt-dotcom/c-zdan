import { test, expect } from "@playwright/test";
import { ACCOUNTS, loginAs } from "../helpers/auth";
import { assertAppReachable, ensureTurkishLocale } from "../helpers/ui";

test.describe("admin auth", () => {
  test.beforeEach(async ({ page }) => {
    await assertAppReachable(page);
  });

  test("logs in as bootstrap admin", async ({ page }) => {
    await loginAs(page, "admin");
    await expect(page).not.toHaveURL(/\/auth$/);
  });

  test("auth page accepts admin credentials form", async ({ page }) => {
    await ensureTurkishLocale(page);
    await page.goto("/auth");
    await page.locator("#li-email").fill(ACCOUNTS.admin.email);
    await page.locator("#li-pw").fill(ACCOUNTS.admin.password);
    await expect(page.getByRole("button", { name: /Giriş yap|Sign in/ })).toBeEnabled();
  });
});
