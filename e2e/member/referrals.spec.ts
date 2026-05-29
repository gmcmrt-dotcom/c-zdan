import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("member referrals", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("member");
    await page.goto("/referrals");
    await prepareAuthenticatedPage(page);
  });

  test("referrals page loads invite hero", async ({ page }) => {
    await expect(page.getByText("Arkadaşını davet et").first()).toBeVisible();
    await expect(page.getByText("Davet linkin").first()).toBeVisible();
  });

  test("shows referral link section or preparing state", async ({ page }) => {
    const linkTitle = page.getByText("Davet linkin");
    const preparing = page.getByText("Davet kodu hazırlanıyor...");
    await expect(linkTitle.or(preparing).first()).toBeVisible();
  });
});
