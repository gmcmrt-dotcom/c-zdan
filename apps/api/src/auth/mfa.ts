import { authenticator } from "otplib";
import qrcode from "qrcode";
import { decryptString, encryptString } from "../lib/crypto";

const TOTP_STEP_SEC = 30;
const TOTP_WINDOW = 1; // ±1 step tolerance (30s before/after)

authenticator.options = { window: TOTP_WINDOW, digits: 6, step: TOTP_STEP_SEC };

const ISSUER = "Wallet";

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function encodeTotpSecret(secret: string): string {
  return encryptString(secret);
}

export function decodeTotpSecret(encrypted: string): string {
  return decryptString(encrypted);
}

export function buildTotpUri(email: string, secret: string): string {
  return authenticator.keyuri(email, ISSUER, secret);
}

export async function buildTotpQrDataUrl(email: string, secret: string): Promise<string> {
  return qrcode.toDataURL(buildTotpUri(email, secret), { errorCorrectionLevel: "M" });
}

export function verifyTotpCode(code: string, secret: string): boolean {
  return authenticator.check(code, secret);
}

/**
 * P1 — Replay-safe TOTP verify.
 *
 * Returns the integer step the code matched (Unix seconds / 30) along with
 * an `ok` flag. The caller MUST persist `matchedStep` and refuse the same
 * code on subsequent attempts by comparing against `lastUsedStep`. The ±1
 * tolerance window means we try the current step plus its neighbours and
 * return the first one that matches.
 */
export interface TotpVerifyResult {
  ok: boolean;
  matchedStep: number | null;
}

export function verifyTotpCodeWithStep(code: string, secret: string): TotpVerifyResult {
  if (!code || !/^\d{6,8}$/.test(code)) return { ok: false, matchedStep: null };
  const nowStep = Math.floor(Date.now() / 1000 / TOTP_STEP_SEC);
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
    const step = nowStep + delta;
    // `generate()` rebuilds the code at a specific Unix time, derived from
    // the step we want to test. `setTime(seconds)` is the documented hook.
    authenticator.options = {
      ...authenticator.options,
      epoch: step * TOTP_STEP_SEC * 1000,
    };
    const expected = authenticator.generate(secret);
    if (expected === code) {
      // Reset epoch back to "live time" so other callers (the simple
      // verifyTotpCode above) keep working against the wall clock.
      authenticator.options = { ...authenticator.options, epoch: undefined };
      return { ok: true, matchedStep: step };
    }
  }
  authenticator.options = { ...authenticator.options, epoch: undefined };
  return { ok: false, matchedStep: null };
}
