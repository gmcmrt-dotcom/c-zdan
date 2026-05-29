import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("member payment", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("member");
    await page.goto("/");
    await prepareAuthenticatedPage(page);
  });

  test("payment page loads from nav", async ({ page }) => {
    const bottomNav = page.locator("nav").filter({
      has: page.getByRole("link", { name: "Ana sayfa" }),
    });
    await bottomNav.getByRole("link", { name: "Ödeme", exact: true }).click();
    await expect(page).toHaveURL(/\/payment/);
    await expect(page.getByText("İş yerinde harcama için kod üret").first()).toBeVisible();
  });

  test("shows balance card and create-code action", async ({ page }) => {
    await page.goto("/payment");
    await expect(page.getByText("Kullanılabilir bakiye").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Kod Üret" })).toBeVisible();
  });
});
