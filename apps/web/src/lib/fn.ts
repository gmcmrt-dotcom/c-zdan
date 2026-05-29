/**
 * Named function invoker — for non-CRUD operations that don't fit the rpc/db
 * model (Aninda push, admin-merchant-secret, chat-attachment-scan, etc.).
 *
 *   const result = await invokeFunction<MyResult>("aninda-withdraw-push", {
 *     session_id: "abc",
 *   });
 *
 * Throws on failure (network, HTTP non-2xx, or business error returned in
 * `{ data, error }` envelope). On success, returns the unwrapped `data`
 * payload.
 *
 * Wire format:
 *   POST /api/fn/<name>  body = arbitrary JSON
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

export async function invokeFunction<T = unknown>(
  name: string,
  body: unknown = {},
): Promise<T> {
  const raw = await apiPost<Envelope<T> | T>(`/fn/${name}`, body);
  if (looksLikeEnvelope(raw)) {
    if (raw.error) {
      throw new ApiError(
        raw.error.statusCode ?? 400,
        raw.error.code ?? "FN_ERROR",
        raw.error.message ?? `Function ${name} failed`,
        raw.error,
      );
    }
    return raw.data as T;
  }
  return raw as T;
}
