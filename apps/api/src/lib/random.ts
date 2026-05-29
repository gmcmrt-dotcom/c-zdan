import { randomBytes, randomInt, createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Cryptographically random hex token. */
export function randomToken(byteLen = 32): string {
  return randomBytes(byteLen).toString("hex");
}

/** N-digit numeric OTP (left-padded). */
export function randomNumericCode(digits = 6): string {
  let s = "";
  for (let i = 0; i < digits; i++) s += randomInt(0, 10).toString();
  return s;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a, "utf8");
  const B = Buffer.from(b, "utf8");
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}

/** 8-digit member number (zero-padded). */
export function genMemberNo(): string {
  return String(randomInt(10_000_000, 99_999_999));
}

/** Referral code: R-XXXXXXXX (uppercase, 8 chars, base32-ish). */
export function genReferralCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  let s = "";
  for (let i = 0; i < 8; i++) s += alphabet[randomInt(0, alphabet.length)];
  return `R-${s}`;
}
