import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("member transactions", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("member");
    await page.goto("/");
    await prepareAuthenticatedPage(page);
  });

  test("transactions page loads from bottom nav", async ({ page }) => {
    const bottomNav = page.locator("nav").filter({
      has: page.getByRole("link", { name: "Ana sayfa" }),
    });
    await bottomNav.getByRole("link", { name: "İşlemler", exact: true }).click();
    await expect(page).toHaveURL(/\/transactions/);
  });
});
