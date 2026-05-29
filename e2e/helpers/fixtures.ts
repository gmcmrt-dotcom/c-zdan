import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, type Page } from "@playwright/test";
import { ACCOUNTS, type AccountRole } from "./auth";
import { dismissOverlays } from "./ui";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, "..", ".auth");

type Manifest = Record<AccountRole, boolean>;

function readManifest(): Manifest | null {
  const manifestPath = path.join(AUTH_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
}

export function authStoragePath(role: AccountRole): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

export function requireAuthRole(role: AccountRole): void {
  const manifest = readManifest();
  if (manifest?.[role]) return;

  const account = ACCOUNTS[role];
  const hint = account.requiresSeed
    ? "run `npm run test:seed` (Option A) first"
    : "run `npm run admin:bootstrap` first";
  test.skip(true, `Auth state for ${account.email} unavailable — ${hint}`);
}

export async function prepareAuthenticatedPage(page: Page): Promise<void> {
  await dismissOverlays(page);
}
