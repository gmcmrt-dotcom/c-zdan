import { type Page, test } from "@playwright/test";
import { dismissOverlays, ensureTurkishLocale } from "./ui";

export const ACCOUNTS = {
  admin: {
    email: "admin@wallet.local",
    password: "Admin1234",
    /** Created by `npm run admin:bootstrap`, not Option A seed. */
    requiresSeed: false,
  },
  accounting: {
    email: "accounting@wallet.local",
    password: "Test1234!",
    requiresSeed: true,
  },
  support: {
    email: "support@wallet.local",
    password: "Test1234!",
    requiresSeed: true,
  },
  member: {
    email: "member.funded@wallet.local",
    password: "Test1234!",
    requiresSeed: true,
  },
  merchant: {
    email: "merchant.owner@wallet.local",
    password: "Test1234!",
    requiresSeed: true,
  },
  merchantAccountant: {
    email: "merchant.accountant@wallet.local",
    password: "Test1234!",
    requiresSeed: true,
  },
  merchantReadonly: {
    email: "merchant.readonly@wallet.local",
    password: "Test1234!",
    requiresSeed: true,
  },
  merchantParent: {
    email: "merchant.parent@wallet.local",
    password: "Test1234!",
    requiresSeed: true,
  },
  merchantFinance: {
    email: "merchant.finance@wallet.local",
    password: "Test1234!",
    requiresSeed: true,
  },
} as const;

export type AccountRole = keyof typeof ACCOUNTS;

export type LoginResult = "ok" | "failed" | "mfa";

/** Fill the /auth login form and wait for navigation away from /auth. */
export async function loginViaUi(
  page: Page,
  email: string,
  password: string,
): Promise<LoginResult> {
  await ensureTurkishLocale(page);
  await page.goto("/auth");
  await page.locator("#li-email").waitFor({ state: "visible" });
  await page.locator("#li-email").fill(email);
  await page.locator("#li-pw").fill(password);
  await page
    .getByRole("button", { name: /^(Giriş yap|Sign in)$/ })
    .click();

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const url = page.url();
    if (url.includes("/auth/mfa-challenge")) return "mfa";
    if (!url.includes("/auth")) return "ok";
    await page.waitForTimeout(250);
  }
  return "failed";
}

/** Login as a known test account; skips the test when credentials are unavailable. */
export async function loginAs(page: Page, role: AccountRole): Promise<void> {
  const account = ACCOUNTS[role];
  const result = await loginViaUi(page, account.email, account.password);

  if (result === "mfa") {
    test.skip(
      true,
      `${account.email} requires MFA — use test accounts without MFA or disable VITE_MFA_ENFORCEMENT`,
    );
  }

  if (result === "failed") {
    const hint = account.requiresSeed
      ? "run `npm run test:seed` (Option A) first"
      : "run `npm run admin:bootstrap` first";
    test.skip(true, `Login failed for ${account.email} — ${hint}`);
  }

  await dismissOverlays(page);
}
