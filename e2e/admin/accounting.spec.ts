import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("admin accounting role", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("accounting");
    await page.goto("/admin");
    await prepareAuthenticatedPage(page);
  });

  test("accounting can open dashboard", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("accounting can open members", async ({ page }) => {
    await page.goto("/admin/members");
    await expect(page.getByText("Üyeler").first()).toBeVisible();
  });

  test("accounting can open transactions", async ({ page }) => {
    await page.goto("/admin/transactions");
    await expect(page.getByText("İşlemler").first()).toBeVisible();
  });

  test("accounting can open merchant children (read-only merchant nav)", async ({ page }) => {
    await page.goto("/admin/merchant-children");
    await prepareAuthenticatedPage(page);
    await expect(page.getByText("Bayiler").first()).toBeVisible();
  });
});
