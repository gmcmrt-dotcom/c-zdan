import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("member home", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("member");
    await page.goto("/");
    await prepareAuthenticatedPage(page);
  });

  test("loads wallet summary and quick actions", async ({ page }) => {
    await expect(page.getByText("Kullanılabilir bakiye").first()).toBeVisible();
    await expect(page.getByText("Ne yapmak istiyorsun?").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Ödeme/i }).first()).toBeVisible();
  });

  test("bottom nav includes payment tab", async ({ page }) => {
    const bottomNav = page.locator("nav").filter({
      has: page.getByRole("link", { name: "Ana sayfa" }),
    });
    await expect(bottomNav.getByRole("link", { name: "Ödeme", exact: true })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "Profil", exact: true })).toBeVisible();
  });
});
