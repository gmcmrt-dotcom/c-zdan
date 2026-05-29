import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("merchant transactions", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("merchant");
    await page.goto("/merchant");
    await prepareAuthenticatedPage(page);
  });

  test("transactions page loads from sidebar", async ({ page }) => {
    await page.getByRole("link", { name: "Üye işlemleri" }).click();
    await expect(page).toHaveURL(/\/merchant\/transactions/);
    await expect(page.getByText("Üye İşlemleri").first()).toBeVisible();
  });

  test("transactions page shows date filter controls", async ({ page }) => {
    await page.goto("/merchant/transactions");
    await expect(page.getByText("Üye İşlemleri").first()).toBeVisible();
    await expect(page.locator("button, select").first()).toBeVisible();
  });
});
