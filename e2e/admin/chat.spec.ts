import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("admin chat inbox", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("admin");
    await page.goto("/admin");
    await prepareAuthenticatedPage(page);
  });

  test("sidebar navigates to /admin/chat", async ({ page }) => {
    await page.getByRole("link", { name: "Destek" }).click();
    await expect(page).toHaveURL(/\/admin\/chat/);
  });

  test("chat route stays authenticated", async ({ page }) => {
    await page.goto("/admin/chat");
    await expect(page).toHaveURL(/\/admin\/chat/);
    await expect(page).not.toHaveURL(/\/auth/);
    await expect(
      page
        .getByRole("heading", { name: "Destek Talepleri" })
        .or(page.getByText("Bir şeyler ters gitti")),
    ).toBeVisible();
  });
});
