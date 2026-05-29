/**
 * Anında trader API client + checksum helpers.
 *
 * Port of supabase/functions/_shared/aninda-kripto.ts. Behaviour preserved:
 *  - MD5 checksum over PascalCase field concat (alphabetical key order)
 *  - PaymentMethodID overrides per kripto / banka / papara
 *  - Optional fallback bank ID
 */
import { createHash } from "node:crypto";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { constantTimeEqual } from "../lib/random";

const DEFAULT_BASE = "https://test-api.nndin.com";
const DEFAULT_PAY_METHOD = "633417664f3595f9463f5593";
const DEFAULT_BANK_ID = "60f16ec5bffe723f3cd51d47";

export const ANINDA_DEPOSIT_CALLBACK_HASH_FIELDS = [
  "Amount",
  "CurrencyCode",
  "Description",
  "Key",
  "PaymentName",
  "PaymentTransactionID",
  "PlayerFullName",
  "PlayerID",
  "Status",
  "TraderTransactionID",
  "Type",
] as const;

export type AnindaApiResponse<T = unknown> = {
  HasError: boolean;
  Description: string;
  Data: T;
  ID: number;
};

export type AnindaAdapter = "aninda" | "aninda_kripto" | "aninda_banka";

export function parseAnindaAdapter(v: string | null | undefined): AnindaAdapter | null {
  if (v === "aninda" || v === "aninda_kripto" || v === "aninda_banka") return v;
  return null;
}

export function usesAnindaAdapter(m: { integrationAdapter?: string | null }): boolean {
  return parseAnindaAdapter(m.integrationAdapter ?? null) !== null;
}

export function anindaApiBase(): string {
  return (env.ANINDA_API_BASE ?? DEFAULT_BASE).replace(/\/$/, "");
}

export function anindaKey(): string {
  // P0-43 — env.ts refuses to boot in production when ANINDA_KEY is unset and
  // Aninda is otherwise configured. The "admin" fallback exists only for
  // unit/dev environments that exercise the callback path without provisioning
  // a key. It must never be reachable in production.
  return env.ANINDA_KEY ?? "admin";
}

export function anindaKeyMatches(bodyKey: string): boolean {
  const got = String(bodyKey ?? "").trim();
  const expected = anindaKey();
  if (got.length === 0 || got.length !== expected.length) return false;
  // Constant-time compare so an attacker cannot bisect the key via timing.
  return constantTimeEqual(got, expected);
}

export function anindaPaymentMethodId(): string {
  return env.ANINDA_PAYMENT_METHOD_ID ?? DEFAULT_PAY_METHOD;
}
export function anindaBankaPaymentMethodId(): string {
  return env.ANINDA_BANKA_PAYMENT_METHOD_ID ?? anindaPaymentMethodId();
}
export function anindaPaparaPaymentMethodId(): string {
  return env.ANINDA_PAPARA_PAYMENT_METHOD_ID ?? anindaPaymentMethodId();
}
export function anindaDefaultBankId(): string {
  return env.ANINDA_DEFAULT_BANK_ID ?? DEFAULT_BANK_ID;
}

/** Build MD5 checksum from PascalCase fields in alphabetical order, plus signing secret. */
export function buildDepositChecksum(
  body: Record<string, string | undefined>,
  signingSecret: string,
): string {
  const concatenated =
    ANINDA_DEPOSIT_CALLBACK_HASH_FIELDS.map((k) => String(body[k] ?? "")).join("") + signingSecret;
  return createHash("md5").update(concatenated, "utf8").digest("hex").toLowerCase();
}

export function verifyDepositChecksum(
  body: Record<string, string | undefined>,
  signingSecret: string,
): boolean {
  const got = String(body.checksum ?? "").trim().toLowerCase();
  if (got.length !== 32) return false;
  const expected = buildDepositChecksum(body, signingSecret);
  // P0-20 — constant-time compare; the previous `got === expected` allowed
  // a timing oracle on each MD5 nibble.
  return constantTimeEqual(got, expected);
}

export interface AnindaDepositLinkInput {
  playerId: string;
  playerFullName: string;
  playerUserName: string;
  traderTransactionId: string;
  paymentMethodId: string;
  amount?: number;
  bankId?: string;
  playerEmail?: string;
}

export async function fetchAnindaDepositLink(
  input: AnindaDepositLinkInput,
): Promise<{ url: string | null; raw: AnindaApiResponse<string> | null }> {
  const body = {
    Key: anindaKey(),
    PlayerID: input.playerId,
    PlayerFullName: input.playerFullName,
    PlayerUserName: input.playerUserName,
    TraderTransactionID: input.traderTransactionId,
    PaymentMethodID: input.paymentMethodId,
    Amount: input.amount != null ? String(input.amount) : undefined,
    BankID: input.bankId,
    PlayerEmail: input.playerEmail,
  };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(`${anindaApiBase()}/trader/get-deposit-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const json = (await res.json().catch(() => null)) as AnindaApiResponse<string> | null;
    if (!json || json.HasError) {
      logger.warn({ json }, "aninda: get-deposit-link returned error");
      return { url: null, raw: json };
    }
    return { url: json.Data, raw: json };
  } catch (err) {
    logger.error({ err }, "aninda: get-deposit-link failed");
    return { url: null, raw: null };
  }
}

export interface AnindaSetWithdrawInput {
  playerId: string;
  playerFullName: string;
  traderTransactionId: string;
  paymentMethodId: string;
  amount: number;
  iban?: string;
  bankId?: string;
  cryptoType?: string;
  payoutAddress?: string;
}

export async function fetchAnindaSetWithdraw(
  input: AnindaSetWithdrawInput,
): Promise<AnindaApiResponse<unknown> | null> {
  const body: Record<string, unknown> = {
    Key: anindaKey(),
    PlayerID: input.playerId,
    PlayerFullName: input.playerFullName,
    TraderTransactionID: input.traderTransactionId,
    PaymentMethodID: input.paymentMethodId,
    Amount: String(input.amount),
  };
  if (input.iban) body.IBAN = input.iban;
  if (input.bankId) body.BankID = input.bankId;
  if (input.cryptoType) body.CryptoType = input.cryptoType;
  if (input.payoutAddress) body.PayoutAddress = input.payoutAddress;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(`${anindaApiBase()}/trader/set-withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return (await res.json().catch(() => null)) as AnindaApiResponse | null;
  } catch (err) {
    logger.error({ err }, "aninda: set-withdraw failed");
    return null;
  }
}

export async function fetchAnindaTokenList(): Promise<Array<{ CryptoType: string; Name: string }>> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(`${anindaApiBase()}/trader/get-token-list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Key: anindaKey() }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const json = (await res.json().catch(() => null)) as AnindaApiResponse<
      Array<{ CryptoType: string; Name: string }>
    > | null;
    if (!json || json.HasError) return [];
    return json.Data ?? [];
  } catch (err) {
    logger.warn({ err }, "aninda: token-list failed");
    return [];
  }
}
