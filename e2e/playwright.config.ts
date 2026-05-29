import { defineConfig, devices } from "@playwright/test";

/**
 * Wallet UI E2E — runs against the Vite dev server (port 8080).
 * Prerequisites: `npm run dev` + seeded test accounts (see e2e/README.md).
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    locale: "tr-TR",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "admin-guest",
      testMatch: "admin/login.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "admin",
      testMatch: "admin/**/*.spec.ts",
      testIgnore: ["admin/login.spec.ts", "admin/accounting.spec.ts", "admin/support.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/admin.json",
      },
    },
    {
      name: "admin-accounting",
      testMatch: "admin/accounting.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/accounting.json",
      },
    },
    {
      name: "admin-support",
      testMatch: "admin/support.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/support.json",
      },
    },
    {
      name: "member-guest",
      testMatch: "member/login.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "member",
      testMatch: "member/**/*.spec.ts",
      testIgnore: "member/login.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/member.json",
      },
    },
    {
      name: "merchant-guest",
      testMatch: "merchant/login.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "merchant",
      testMatch: "merchant/**/*.spec.ts",
      testIgnore: [
        "merchant/login.spec.ts",
        "merchant/role-deny.spec.ts",
        "merchant/accountant.spec.ts",
        "merchant/parent-children.spec.ts",
        "merchant/finance-dashboard.spec.ts",
        "merchant/menu-matrix.spec.ts",
      ],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/merchant.json",
      },
    },
    {
      name: "merchant-accountant",
      testMatch: "merchant/accountant.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/merchantAccountant.json",
      },
    },
    {
      name: "merchant-readonly",
      testMatch: "merchant/role-deny.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/merchantReadonly.json",
      },
    },
    {
      name: "merchant-parent",
      testMatch: "merchant/parent-children.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/merchantParent.json",
      },
    },
    {
      name: "merchant-finance",
      testMatch: "merchant/finance-dashboard.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/merchantFinance.json",
      },
    },
  ],
});
