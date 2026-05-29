import { type Page } from "@playwright/test";

/** i18next reads `localStorage.lang` before navigator — pin Turkish for E2E. */
export async function ensureTurkishLocale(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "tr");
  });
}

/** Close first-login tour and other blocking overlays. */
export async function dismissOverlays(page: Page): Promise<void> {
  const skipTour = page.getByRole("button", { name: "Atla" });
  if (await skipTour.isVisible({ timeout: 1500 }).catch(() => false)) {
    await skipTour.click();
  }

  await page
    .locator(".animate-spin")
    .first()
    .waitFor({ state: "hidden", timeout: 15_000 })
    .catch(() => {});
}

/** Assert the dev stack responds before running UI flows. */
export async function assertAppReachable(page: Page): Promise<void> {
  await ensureTurkishLocale(page);
  const response = await page.goto("/auth", { waitUntil: "domcontentloaded" });
  if (!response || !response.ok()) {
    throw new Error(
      "Dev server not reachable at baseURL — start with `npm run dev` (port 8080)",
    );
  }
}
