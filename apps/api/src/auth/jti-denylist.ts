/**
 * Access-token JTI denylist (P2).
 *
 * Access tokens are short-lived (15 min default) so we don't normally need
 * per-token revocation. The denylist exists as an *emergency revoke* lever:
 * if a specific access token is suspected of being stolen, the operator can
 * add its JTI here and the next request that presents it gets `401`. Entries
 * expire automatically after the access-token TTL so the map stays small.
 *
 * Implementation is intentionally in-memory (Map) and per-process:
 *   - The check runs on every request (added to `requireAuth`); reads need
 *     to be O(1) and node-local. A network round-trip would defeat the
 *     point of a short access-token TTL.
 *   - On multi-node deploys (when added), wire the same API to a shared
 *     Redis SET with TTL — keep the function signature stable so callers
 *     don't change.
 *   - On process restart the denylist resets. That's acceptable because the
 *     tokens it was holding will expire on their own within ~15 min.
 *
 * NOTE: this is a *denylist*, not an allowlist. Tokens not in the map are
 * still valid by default. Use `revokeAllForUser` (DB) for permanent revoke
 * of every refresh; this map only blocks already-issued access JWTs in
 * flight.
 */

import { env } from "../lib/env";

const denylist = new Map<string, number /* expires-at ms */>();

/**
 * Record a JTI as denied. Auto-expires after the access-token TTL so the map
 * doesn't grow unbounded.
 */
export function denyAccessJti(jti: string): void {
  if (!jti) return;
  denylist.set(jti, Date.now() + env.JWT_ACCESS_TTL_SEC * 1000);
}

/** True if the JTI is denied (and not yet auto-expired). */
export function isAccessJtiDenied(jti: string | undefined | null): boolean {
  if (!jti) return false;
  const exp = denylist.get(jti);
  if (!exp) return false;
  if (exp < Date.now()) {
    denylist.delete(jti);
    return false;
  }
  return true;
}

/** Periodic sweep to evict expired entries (called from the cron scheduler). */
export function sweepExpiredJtis(): { swept: number; remaining: number } {
  let swept = 0;
  const now = Date.now();
  for (const [k, v] of denylist) {
    if (v < now) {
      denylist.delete(k);
      swept++;
    }
  }
  return { swept, remaining: denylist.size };
}

/** Test helper — reset state. */
export function _resetJtiDenylistForTests(): void {
  denylist.clear();
}
