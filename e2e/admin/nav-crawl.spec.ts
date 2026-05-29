import { test, expect } from "@playwright/test";
import { requireAuthRole, prepareAuthenticatedPage } from "../helpers/fixtures";

const ADMIN_ROUTES: Array<{ path: string; label: string | RegExp }> = [
  { path: "/admin", label: "Dashboard" },
  { path: "/admin/members", label: "Üyeler" },
  { path: "/admin/transactions", label: "İşlemler" },
  { path: "/admin/chat", label: /Destek Talepleri|Bir şeyler ters gitti/ },
  { path: "/admin/merchants?type=commerce", label: /Ticari|Merchant/ },
  { path: "/admin/merchant-children", label: "Bayiler" },
  { path: "/admin/merchants?type=finance", label: /Finans|Merchant/ },
  { path: "/admin/finance-integrations", label: /Finance Entegrasyon/ },
  { path: "/admin/commissions", label: /Komisyon/ },
  { path: "/admin/profit-share", label: /Kazanç Dağıtımı/ },
  { path: "/admin/reconciliation", label: "Mutabakat" },
  { path: "/admin/loyalty", label: /Sadakat/ },
  { path: "/admin/referrals", label: "Davetler" },
  { path: "/admin/system-logs", label: /Sistem Log/ },
  { path: "/admin/settings", label: /Sistem Ayarları/ },
  { path: "/admin/users", label: "Kullanıcılar" },
  { path: "/admin/permissions", label: "Yetkiler" },
  { path: "/admin/templates", label: "Şablonlar" },
  { path: "/admin/method-types", label: "Yöntem Tipleri" },
  { path: "/admin/onboarding", label: /Merchant Onboarding|Onboarding/ },
];

test.describe("admin nav crawl", () => {
  test.beforeEach(() => {
    requireAuthRole("admin");
  });

  for (const route of ADMIN_ROUTES) {
    test(`loads ${route.path}`, async ({ page }) => {
      await page.goto(route.path);
      await prepareAuthenticatedPage(page);
      await expect(page).not.toHaveURL(/\/auth/);
      const matcher =
        typeof route.label === "string"
          ? page.getByText(route.label, { exact: false }).first()
          : page.getByText(route.label).first();
      await expect(matcher).toBeVisible({ timeout: 15_000 });
    });
  }
});
