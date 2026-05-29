import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("member profit share", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("member");
    await page.goto("/profit-share");
    await prepareAuthenticatedPage(page);
  });

  test("loads profit share rewards page", async ({ page }) => {
    await expect(page).toHaveURL(/\/profit-share/);
    await expect(page.getByRole("heading", { name: "Kazanç Payı" })).toBeVisible();
    await expect(page.getByText("Nasıl çalışır?").first()).toBeVisible();
    await expect(page.getByText(/Beklenmeyen bir hata|Failed to fetch dynamically imported module/i)).toHaveCount(0);
  });

  test("shows empty state or pending rewards section", async ({ page }) => {
    await expect(
      page
        .getByText("Şu an bekleyen kazanç payı yok")
        .or(page.getByText("Bekleyen ödüller"))
        .or(page.getByText("Geçmiş kazanç payları")),
    ).toBeVisible({ timeout: 15_000 });
  });
});
