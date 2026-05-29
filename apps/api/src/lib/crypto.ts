import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env";

/**
 * AES-256-GCM symmetric encryption for at-rest secrets (e.g. TOTP factor seeds).
 * Key derived from env (32 bytes / 64 hex chars).
 */
const KEY = Buffer.from(env.MFA_ENCRYPTION_KEY, "hex");
if (KEY.length !== 32) {
  throw new Error("[crypto] MFA_ENCRYPTION_KEY must decode to 32 bytes (64 hex chars)");
}

const ALG = "aes-256-gcm";

/** Encrypted blob format: base64(iv | tag | ciphertext). */
export function encryptString(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptString(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  if (buf.length < 12 + 16 + 1) throw new Error("ciphertext too short");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv(ALG, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * P0-12 — Resolve a merchant signing secret to plaintext, preferring the
 * encrypted column. Returns null if neither column has a value.
 * Used by `merchant-hmac.ts` during the staged encryption migration.
 */
export function resolveMerchantSigningSecret(
  encrypted: string | null | undefined,
  plaintext: string | null | undefined,
): string | null {
  if (encrypted && encrypted.length > 0) {
    try {
      return decryptString(encrypted);
    } catch {
      // Encrypted column present but unreadable (wrong key, corruption).
      // Fall back to plaintext during the migration window so live merchants
      // keep working; flag in logs so ops notices.
      // eslint-disable-next-line no-console
      console.warn("[crypto] signing_secret_encrypted decrypt failed, falling back to plaintext");
    }
  }
  return plaintext ?? null;
}
