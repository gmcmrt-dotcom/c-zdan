import { test, expect } from "@playwright/test";
import { ACCOUNTS, loginAs } from "../helpers/auth";
import { assertAppReachable, ensureTurkishLocale } from "../helpers/ui";

test.describe("member auth", () => {
  test.beforeEach(async ({ page }) => {
    await assertAppReachable(page);
  });

  test("logs in and lands on member home", async ({ page }) => {
    await loginAs(page, "member");
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expect(page.getByText("Kullanılabilir bakiye").first()).toBeVisible();
  });

  test("shows auth form with login tab", async ({ page }) => {
    await ensureTurkishLocale(page);
    await page.goto("/auth");
    await expect(page.locator("#li-email")).toBeVisible();
    await expect(page.locator("#li-pw")).toBeVisible();
    await expect(page.getByRole("tab", { name: /Giriş|Sign in/ })).toBeVisible();
    await expect(page.getByText(ACCOUNTS.member.email)).not.toBeVisible();
  });
});
