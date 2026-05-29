import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

test.describe("merchant cashout", () => {
  test.beforeEach(async ({ page }) => {
    requireAuthRole("merchant");
    await page.goto("/merchant/cashout");
    await prepareAuthenticatedPage(page);
  });

  test("cashout form page loads", async ({ page }) => {
    await expect(page).toHaveURL(/\/merchant\/cashout/);
    await expect(page.getByText("Tahsilat").first()).toBeVisible();
  });

  test("shows seeded balance on cashout stats", async ({ page }) => {
    await expect(page.getByText("Defter bakiyesi").first()).toBeVisible();
    await expect(page.getByText(/₺243,75|₺243\.75/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("cashout request form fields visible", async ({ page }) => {
    await expect(page.getByText("Yeni tahsilat talebi")).toBeVisible();
    await expect(page.getByText("Yöntem").first()).toBeVisible();
    await expect(page.getByText("Tutar (₺)").first()).toBeVisible();
    await expect(page.getByText("Kripto cüzdan adresi").first()).toBeVisible();
  });

  test("USDT method shows required platform commission field", async ({ page }) => {
    const form = page.locator("text=Yeni tahsilat talebi").locator("xpath=ancestor::div[contains(@class,'space-y-4')]");
    const methodSelect = form.getByRole("combobox").first();

    await methodSelect.click();
    await page.getByRole("option", { name: /Bitcoin/i }).click();
    await expect(page.getByText("Platform komisyonu (₺) — gelir")).toHaveCount(0);

    await methodSelect.click();
    await page.getByRole("option", { name: /USDT \(TRC20\)/i }).click();

    const commissionLabel = page.getByText("Platform komisyonu (₺) — gelir");
    await expect(commissionLabel).toBeVisible();
    const commissionInput = commissionLabel.locator("xpath=following-sibling::input[1]");
    await expect(commissionInput).toBeVisible();
    await expect(commissionInput).toHaveAttribute("placeholder", "0");
    await expect(page.getByText("USDT tahsilatında komisyon tutarı platform geliri olarak kaydedilir.")).toBeVisible();

    await page.getByPlaceholder("0", { exact: true }).first().fill("100");
    const submit = page.getByRole("button", { name: "Tahsilat talebi oluştur" });
    await expect(submit).toBeDisabled();
    await commissionInput.fill("2.5");
    await expect(submit).toBeEnabled();
  });
});
