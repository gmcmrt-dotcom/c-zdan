/**
 * Storage HTTP endpoints.
 *
 * Upload (authenticated, multipart):
 *   POST /storage/<bucket>?path=<path>     multipart/form-data file=<binary>
 *   → { path, size, signedUrl }
 *
 * Signed-URL fetch (public, but token gated):
 *   GET  /storage/o/<token>
 *   → streams the file with correct content-type + cache headers.
 *
 * P0-5 — Storage path ownership.
 *
 * Every upload is silently re-keyed under `u/{userId}/...` so callers can
 * only write into their own prefix. Signed-URL builds and deletes require
 * the path to start with `u/{userId}/` unless the caller has staff chat
 * permissions (chat:view_all / chat:reply / chat:approve_pcr) which need
 * to read/clean up other members' attachments. The public token endpoint
 * is unchanged: the HMAC token IS the auth, but ownership is now baked
 * into the path so a stolen token can only target one user's bucket.
 *
 * Legacy paths (uploaded before this fix) are left in place — signed URLs
 * created at the time are still valid; new writes for the same legical
 * file will simply land under the user's prefix.
 */
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth, user } from "../middleware/auth";
import { loadUserPerms } from "../middleware/permission";
import { buckets, put, read, remove as removeFile, signedUrl, verifySignedToken } from "../storage/local";
import { BadRequestError, ForbiddenError, NotFoundError } from "../lib/errors";

export const storageRouter = Router();

// P1 — Per-bucket cap is enforced in `put()`. The HTTP-level hard cap below
// matches nginx `client_max_body_size 25m` minus headers; aligned across
// layers so a misconfigured client sees one consistent rejection. Multer is
// kept on memory storage because chat-attachments are small (≤10 MB); when
// we add larger buckets we should switch to diskStorage with a janitor.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 24 * 1024 * 1024 },
});

const STAFF_OVERRIDE_PERMS = [
  "chat:view_all",
  "chat:reply",
  "chat:approve_pcr",
];

function userPrefix(userId: string): string {
  return `u/${userId}/`;
}

/**
 * P2 — MIME magic-byte sniff.
 *
 * The browser-supplied `file.mimetype` is whatever the client says. An
 * attacker can upload `evil.svg` (XSS via embedded <script>) with
 * `mimetype: image/png`, or push an HTML payload with `mimetype: image/jpeg`.
 * The signed-URL streamer serves the bytes with `file.mimeType` headers, so
 * a mismatch lets the file render as the claimed type in the browser.
 *
 * We sniff the first few bytes for known signatures and refuse any upload
 * whose claimed family (image/pdf) doesn't match the detected family.
 * Non-image / non-pdf uploads (text, json, etc.) are pass-through with the
 * claimed type — the bucket allowlist + bucket-level content rules cover
 * those.
 */
const MAGIC_SIGNATURES: Array<{ family: "image" | "pdf"; mime: string; magic: number[] }> = [
  { family: "image", mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { family: "image", mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  { family: "image", mime: "image/gif", magic: [0x47, 0x49, 0x46, 0x38] }, // GIF8
  { family: "image", mime: "image/webp", magic: [0x52, 0x49, 0x46, 0x46] }, // RIFF (further check below)
  { family: "pdf", mime: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
];

function sniffMime(buf: Buffer): { family: "image" | "pdf"; mime: string } | null {
  if (!buf || buf.length < 4) return null;
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.magic.every((b, i) => buf[i] === b)) {
      // WebP needs the "WEBP" marker at offset 8 to be a real WebP.
      if (sig.mime === "image/webp" && buf.toString("ascii", 8, 12) !== "WEBP") continue;
      return { family: sig.family, mime: sig.mime };
    }
  }
  return null;
}

function assertMimeMatches(claimed: string, buf: Buffer): void {
  // Only enforce for the families we sniff for; other types (text/*, json,
  // octet-stream) are pass-through. SVG is INTENTIONALLY rejected when
  // claimed as an image because it can carry executable script — callers
  // that need vector graphics should upload PNG/PDF instead.
  const lower = (claimed ?? "").toLowerCase();
  if (lower === "image/svg+xml" || lower === "image/svg") {
    throw new BadRequestError("SVG_UPLOAD_NOT_ALLOWED");
  }
  const claimsImage = lower.startsWith("image/");
  const claimsPdf = lower === "application/pdf";
  if (!claimsImage && !claimsPdf) return; // not sniffed; trust + serve as-is
  const detected = sniffMime(buf);
  if (!detected) throw new BadRequestError("FILE_TYPE_UNRECOGNIZED");
  if (claimsImage && detected.family !== "image") throw new BadRequestError("FILE_TYPE_MISMATCH");
  if (claimsPdf && detected.family !== "pdf") throw new BadRequestError("FILE_TYPE_MISMATCH");
  if (lower !== detected.mime) {
    // The CLAIMED specific subtype must match the detected one (e.g. claiming
    // image/png with a JPEG payload). This catches the most common spoof.
    throw new BadRequestError("FILE_TYPE_MISMATCH");
  }
}

function isStaffStorageOverride(req: import("express").Request): boolean {
  if (!req.perms) return false;
  for (const p of STAFF_OVERRIDE_PERMS) if (req.perms.has(p)) return true;
  return false;
}

/**
 * Ensure the path starts with the caller's user prefix. If it already does,
 * pass through. Otherwise prepend it. Staff with override perms keep the
 * raw path so they can write into other users' prefixes for support tasks.
 */
function scopePathForWrite(req: import("express").Request, rawPath: string): string {
  if (isStaffStorageOverride(req)) return rawPath;
  const pref = userPrefix(user(req).id);
  if (rawPath.startsWith(pref)) return rawPath;
  return pref + rawPath.replace(/^\/+/, "");
}

/**
 * Verify the caller may sign / delete the given path. Members can only act
 * on their own prefix; staff with chat overrides can act on any path.
 */
function assertOwnedPath(req: import("express").Request, p: string): void {
  if (isStaffStorageOverride(req)) return;
  const pref = userPrefix(user(req).id);
  if (!p.startsWith(pref)) {
    throw new ForbiddenError("PATH_NOT_OWNED");
  }
}

// Upload — authed
storageRouter.post(
  "/:bucket",
  requireAuth,
  loadUserPerms,
  upload.single("file"),
  async (req, res, next) => {
    try {
      const bucket = req.params.bucket!;
      if (!buckets[bucket]) throw new NotFoundError("BUCKET_NOT_FOUND");
      const q = z.object({ path: z.string().min(1) }).parse(req.query);
      const file = req.file;
      if (!file) throw new BadRequestError("FILE_REQUIRED");
      // P2 — Reject mismatch between claimed mimetype and detected magic
      // bytes (and reject SVG outright). Closes the
      // upload-evil.svg-as-image/png XSS-on-serve vector.
      assertMimeMatches(file.mimetype, file.buffer);
      const scopedPath = scopePathForWrite(req, q.path);
      const { size } = await put({
        bucket,
        path: scopedPath,
        buffer: file.buffer,
        mimeType: file.mimetype,
      });
      res.json({
        // The client MUST use the returned path (not the requested one) when
        // persisting `storage_path` to chat_attachments etc.
        path: scopedPath,
        size,
        mimeType: file.mimetype,
        // H1 — Bind the signed URL to the uploader's user id. The read
        // endpoint enforces that the bearer matches; a leaked URL won't
        // work for anyone else.
        signedUrl: signedUrl(bucket, scopedPath, 300, { userId: user(req).id }),
      });
    } catch (e) {
      next(e);
    }
  },
);

// Batch removal — authed, idempotent
storageRouter.delete("/:bucket", requireAuth, loadUserPerms, async (req, res, next) => {
  try {
    const bucket = req.params.bucket!;
    if (!buckets[bucket]) throw new NotFoundError("BUCKET_NOT_FOUND");
    const body = z.object({ paths: z.array(z.string().min(1)).max(50) }).parse(req.body ?? {});
    for (const p of body.paths) assertOwnedPath(req, p);
    await Promise.all(body.paths.map((p) => removeFile(bucket, p)));
    res.json({ success: true, removed: body.paths.length });
  } catch (e) { next(e); }
});

// Authenticated signed-URL builder (frontend may also build them inline via /me endpoints later)
storageRouter.get("/:bucket/signed-url", requireAuth, loadUserPerms, async (req, res, next) => {
  try {
    const bucket = req.params.bucket!;
    if (!buckets[bucket]) throw new NotFoundError("BUCKET_NOT_FOUND");
    const q = z
      .object({ path: z.string().min(1), ttlSeconds: z.coerce.number().min(30).max(3600).default(300) })
      .parse(req.query);
    assertOwnedPath(req, q.path);
    // H1 — Sign with the requester's user id; staff overriders get a URL
    // scoped to their own id (still unique). The read endpoint enforces
    // the match.
    res.json({ signedUrl: signedUrl(bucket, q.path, q.ttlSeconds, { userId: user(req).id }) });
  } catch (e) { next(e); }
});

// Public — token-gated stream.
//
// H1 — When the token was signed with a userId (v2), require a bearer token
// belonging to that user. v1 (legacy unsigned-user) tokens still serve
// without bearer for back-compat with already-issued URLs in the wild.
storageRouter.get("/o/:token", async (req, res, next) => {
  try {
    const payload = verifySignedToken(req.params.token!);
    if (payload.userId) {
      // The signed URL is owner-locked. Require a valid bearer that matches.
      try {
        const hdr = req.headers.authorization;
        const tok = hdr?.startsWith("Bearer ") ? hdr.slice(7) : null;
        if (!tok) throw new ForbiddenError("BEARER_REQUIRED");
        const { verifyAccessToken } = await import("../auth/jwt");
        const claims = await verifyAccessToken(tok);
        // Staff with storage override perm can read any owner-locked URL.
        const { isStaffStorageOverride } = await import("./storage-override");
        const staff = await isStaffStorageOverride(claims.sub);
        if (claims.sub !== payload.userId && !staff) {
          throw new ForbiddenError("OWNER_MISMATCH");
        }
      } catch (err) {
        if (err instanceof ForbiddenError) throw err;
        throw new ForbiddenError("BEARER_REQUIRED");
      }
    }
    const file = await read(payload.bucket, payload.path);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", String(file.size));
    res.setHeader("Cache-Control", "private, max-age=60");
    // I1 — Defence in depth: never let `/storage/*` content render inside
    // a third-party iframe. Helmet's CSP `frame-ancestors 'none'` already
    // covers HTML responses; X-Frame-Options DENY covers older browsers
    // and the non-HTML asset surface explicitly.
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Disposition", "inline");
    file.stream.pipe(res);
  } catch (e) { next(e); }
});
