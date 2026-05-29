import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("merchant commerce menu", () => {
  test("commerce owner sees cashout and api docs", async ({ page }) => {
    requireAuthRole("merchant");
    await page.goto("/merchant");
    await prepareAuthenticatedPage(page);
    await expect(page.getByRole("link", { name: "Tahsilat" })).toBeVisible();
    await expect(page.getByRole("link", { name: "API dokümantasyonu" })).toBeVisible();
  });
});
