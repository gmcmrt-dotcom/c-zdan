/**
 * Native RPC client.
 *
 *   const data = await rpc<MyDto>("my_rpc_name", { arg: 1 });
 *
 * Throws on failure (network, HTTP non-2xx, or business error returned in
 * `{ data, error }` envelope from the server). On success, returns the
 * unwrapped `data` payload.
 *
 * Wire format:
 *   POST /api/rpc/<name>  body = args object
 *   Success → { "data": <payload>, "error": null }   (200 OK)
 *   Failure → { "data": null, "error": { "code": "...", "message": "..." } }
 */
import { ApiError, apiPost } from "./api";

type Envelope<T> = {
  data: T | null;
  error: { code?: string; message?: string; statusCode?: number } | null;
};

function looksLikeEnvelope(x: unknown): x is Envelope<unknown> {
  return (
    typeof x === "object" &&
    x !== null &&
    "data" in (x as Record<string, unknown>) &&
    "error" in (x as Record<string, unknown>)
  );
}

export async function rpc<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const raw = await apiPost<Envelope<T> | T>(`/rpc/${name}`, args);
  if (looksLikeEnvelope(raw)) {
    if (raw.error) {
      const code = raw.error.code ?? "RPC_ERROR";
      if (code === "STAFF_REQUIRED" || code === "PERMISSION_DENIED") {
        window.dispatchEvent(new Event("wallet.auth-changed"));
      }
      throw new ApiError(
        raw.error.statusCode ?? 400,
        code,
        raw.error.message ?? `RPC ${name} failed`,
        raw.error,
      );
    }
    return raw.data as T;
  }
  // Endpoint already returns the raw payload (rare — tolerated).
  return raw as T;
}
