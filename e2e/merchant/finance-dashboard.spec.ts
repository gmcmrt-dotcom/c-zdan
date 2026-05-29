import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("merchant finance owner", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("merchantFinance");
    await page.goto("/merchant");
    await prepareAuthenticatedPage(page);
  });

  test("finance dashboard loads without commerce cashout nav", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Dashboard" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Tahsilat" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "API dokümantasyonu" })).toHaveCount(0);
  });

  test("finance settlement shows kasa defteri", async ({ page }) => {
    await page.goto("/merchant/settlement");
    await prepareAuthenticatedPage(page);
    await expect(page).toHaveURL(/\/merchant\/settlement/);
    await expect(page.getByText("Kasa Defteri").first()).toBeVisible();
  });
});
