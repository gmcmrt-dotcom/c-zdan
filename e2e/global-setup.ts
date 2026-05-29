import { chromium, type FullConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACCOUNTS, type AccountRole, loginViaUi } from "./helpers/auth";
import { ensureTurkishLocale } from "./helpers/ui";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, ".auth");

type Manifest = Record<AccountRole, boolean>;

async function trySaveAuth(
  baseURL: string,
  role: AccountRole,
): Promise<boolean> {
  const account = ACCOUNTS[role];
  const outPath = path.join(AUTH_DIR, `${role}.json`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL, locale: "tr-TR" });
  const page = await context.newPage();
  await ensureTurkishLocale(page);

  const result = await loginViaUi(page, account.email, account.password);
  const ok = result === "ok";

  await context.storageState({ path: outPath });
  await browser.close();
  return ok;
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const baseURL =
    (config.projects[0]?.use?.baseURL as string | undefined) ??
    process.env.E2E_BASE_URL ??
    "http://localhost:8080";

  const manifest = {} as Manifest;

  for (const role of Object.keys(ACCOUNTS) as AccountRole[]) {
    manifest[role] = await trySaveAuth(baseURL, role);
  }

  fs.writeFileSync(
    path.join(AUTH_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
}
