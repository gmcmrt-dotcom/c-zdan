/**
 * Native storage adapter (local filesystem backend behind HMAC-signed URLs).
 *
 *   const { path } = await storageUpload("chat-attachments", "u/123/file.png", file);
 *   const url     = await storageSignedUrl("chat-attachments", path, 300);
 *   await storageRemove("chat-attachments", [path]);
 *
 * Wire format: POST /storage/<bucket>?path=… for upload, GET /storage/<bucket>/signed-url
 * for time-limited URLs, DELETE /storage/<bucket> for removal.
 *
 * Auth (Batch O): access token rides as an HttpOnly cookie thanks to
 * `credentials: "include"`. State-changing methods echo the JS-readable
 * `csrf_token` cookie in the `X-CSRF-Token` header (the back-end CSRF
 * middleware refuses the request without it).
 */
import { api } from "./api";

export class StorageError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message || code);
  }
}

const CSRF_COOKIE = "csrf_token";

function readCookie(name: string): string | null {
  const m = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[$()*+./?[\\\]^{|}-]/g, "\\$&")}=([^;]*)`),
  );
  return m ? decodeURIComponent(m[1]!) : null;
}

/**
 * Upload a Blob/File to `path` inside `bucket`. Returns the absolute storage
 * path the server settled on (may add hash/timestamp suffix server-side).
 */
export async function storageUpload(
  bucket: string,
  path: string,
  file: Blob | File,
): Promise<{ path: string }> {
  const form = new FormData();
  form.append("file", file as Blob, (file as File).name ?? "upload");
  const csrf = readCookie(CSRF_COOKIE);
  const headers: Record<string, string> = {};
  if (csrf) headers["X-CSRF-Token"] = csrf;
  const res = await fetch(`/storage/${bucket}?path=${encodeURIComponent(path)}`, {
    method: "POST",
    body: form,
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new StorageError(
      (body && (body as { error_code?: string }).error_code) ?? `HTTP_${res.status}`,
      (body && (body as { message?: string }).message) ?? `Upload failed (${res.status})`,
    );
  }
  return res.json();
}

/**
 * Generate a signed URL the browser can use for `ttlSeconds` (default 300).
 * URL is absolute so it works in `<img src>` / `window.open`.
 */
export async function storageSignedUrl(
  bucket: string,
  path: string,
  ttlSeconds = 300,
): Promise<string> {
  const r = await api<{ signedUrl: string }>(
    `/storage/${bucket}/signed-url?path=${encodeURIComponent(path)}&ttlSeconds=${ttlSeconds}`,
    { method: "GET" },
  );
  return r.signedUrl.startsWith("/")
    ? `${window.location.origin}${r.signedUrl}`
    : r.signedUrl;
}

/**
 * Best-effort removal — failures are swallowed (matches the old shim
 * semantics; we don't want stranded UI when a cleanup race happens).
 */
export async function storageRemove(bucket: string, paths: string[]): Promise<void> {
  try {
    await api(`/storage/${bucket}`, {
      method: "DELETE",
      body: { paths },
    });
  } catch {
    // intentional
  }
}

/** Aggregate export so callers can `import { storage } from "@/lib/storage"`. */
export const storage = {
  upload: storageUpload,
  signedUrl: storageSignedUrl,
  remove: storageRemove,
};
