import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("admin support role", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("support");
    await page.goto("/admin");
    await prepareAuthenticatedPage(page);
  });

  test("support can open dashboard", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("support can open chat inbox", async ({ page }) => {
    await page.goto("/admin/chat");
    await expect(page).toHaveURL(/\/admin\/chat/);
    await expect(
      page.getByRole("heading", { name: "Destek Talepleri" }).or(
        page.getByText("Bir şeyler ters gitti"),
      ),
    ).toBeVisible();
  });

  test("support cannot open admin settings", async ({ page }) => {
    await page.goto("/admin/settings");
    await prepareAuthenticatedPage(page);
    await expect(
      page.getByText(/Erişim|yetkiniz|403|Forbidden|Bir şeyler ters gitti/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
