import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("admin profit share", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("admin");
    await page.goto("/admin/profit-share");
    await prepareAuthenticatedPage(page);
  });

  test("loads profit share page without dynamic import error", async ({ page }) => {
    await expect(page).toHaveURL(/\/admin\/profit-share/);
    await expect(page.getByRole("heading", { name: "Kazanç Dağıtımı", exact: true })).toBeVisible();
    await expect(page.getByText("Muhasebe kuralı").first()).toBeVisible();
    await expect(page.getByText(/Beklenmeyen bir hata|Failed to fetch dynamically imported module/i)).toHaveCount(0);
  });

  test("shows campaign list or empty state and preview form", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Kampanyalar" })).toBeVisible();
    await expect(
      page.getByText(/Henüz kampanya yok|Yükleniyor\.\.\./).or(page.locator("table tbody tr").first()),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Hesapla" })).toBeVisible();
    await expect(page.getByText("Dağıtım oranı (%)").first()).toBeVisible();
  });
});
