import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("merchant cashout", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("merchant");
    await page.goto("/merchant/cashout");
    await prepareAuthenticatedPage(page);
  });

  test("cashout form page loads", async ({ page }) => {
    await expect(page).toHaveURL(/\/merchant\/cashout/);
    await expect(page.getByText("Tahsilat").first()).toBeVisible();
  });

  test("shows seeded balance on cashout stats", async ({ page }) => {
    await expect(page.getByText("Defter bakiyesi").first()).toBeVisible();
    await expect(page.getByText(/₺243,75|₺243\.75/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("cashout request form fields visible", async ({ page }) => {
    await expect(page.getByText("Yeni tahsilat talebi")).toBeVisible();
    await expect(page.getByText("Yöntem").first()).toBeVisible();
    await expect(page.getByText("Tutar (₺)").first()).toBeVisible();
    await expect(page.getByText("Kripto cüzdan adresi").first()).toBeVisible();
  });
});
