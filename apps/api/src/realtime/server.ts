/**
 * Socket.IO server — JWT-authenticated, room-based.
 *
 * Rooms:
 *   - `user:<userId>`                — per-user notification stream
 *   - `chat:thread:<threadId>`       — live thread messages + PCRs
 *   - `chat:staff`                   — all staff watch this for new threads
 *
 * Client API (see apps/web/src/lib/socket.ts):
 *   socket = io("/ws", { auth: { token } })
 *   socket.emit("subscribe", { rooms: ["chat:thread:..."] })
 *
 * Service modules call `emitNotification`, `emitChatMessage`, etc. from the
 * request handler after a successful DB mutation.
 */
import { Server as IoServer, type Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { chatThreads, userRoles } from "../db/schema";
import { eq } from "drizzle-orm";
import { verifyAccessToken } from "../auth/jwt";
import { corsOrigins } from "../lib/env";
import { logger } from "../lib/logger";

/**
 * Batch O — Socket.IO handshake auth now mirrors the HTTP middleware:
 *
 *   1. `socket.handshake.auth.token` — legacy clients that still pass an
 *      access token explicitly (pre-Batch O behavior). Kept for back-compat
 *      and for non-browser callers (CLI/integration tests).
 *   2. `Authorization: Bearer …` header — same back-compat reason.
 *   3. `Cookie: access_token=…` — the new default. Web clients connect
 *      with `withCredentials: true` so the cookie rides on the WS upgrade.
 *
 * Parses cookies inline (no dependency added) — only one cookie name to
 * extract.
 */
function parseAccessCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== "access_token") continue;
    const value = part.slice(eq + 1).trim();
    return value ? decodeURIComponent(value) : undefined;
  }
  return undefined;
}

function extractSocketToken(socket: Socket): string | undefined {
  const fromAuth = socket.handshake.auth?.token;
  if (typeof fromAuth === "string" && fromAuth.length > 0) return fromAuth;
  const header = socket.handshake.headers.authorization?.toString();
  if (header) {
    const stripped = header.replace(/^Bearer\s+/i, "");
    if (stripped && stripped !== header) return stripped;
  }
  return parseAccessCookie(socket.handshake.headers.cookie);
}

let io: IoServer | null = null;

interface SocketData {
  userId: string;
  email: string;
  isStaff: boolean;
}

async function isStaffUser(userId: string): Promise<boolean> {
  const [r] = await db.select({ id: userRoles.id }).from(userRoles).where(eq(userRoles.userId, userId)).limit(1);
  return !!r;
}

const ALLOWED_ROOM_RE = /^(user:[0-9a-f-]{36}|chat:thread:[0-9a-f-]{36}|chat:staff)$/;

export function buildIo(httpServer: HttpServer): IoServer {
  const server = new IoServer(httpServer, {
    path: "/ws",
    cors: {
      origin: (origin, cb) => {
        if (!origin || corsOrigins.includes("*") || corsOrigins.includes(origin))
          return cb(null, true);
        cb(new Error(`Origin ${origin} not allowed`), false);
      },
      credentials: true,
    },
  });

  server.use(async (socket, next) => {
    try {
      const token = extractSocketToken(socket);
      if (!token) return next(new Error("MISSING_TOKEN"));
      const claims = await verifyAccessToken(token);
      const staff = await isStaffUser(claims.sub);
      (socket.data as SocketData) = {
        userId: claims.sub,
        email: claims.email,
        isStaff: staff,
      };
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  server.on("connection", (socket: Socket) => {
    const data = socket.data as SocketData;
    // Always join user's private room
    socket.join(`user:${data.userId}`);
    if (data.isStaff) socket.join("chat:staff");

    logger.debug({ userId: data.userId, sid: socket.id }, "socket connected");

    // H1 — Periodic JWT re-verification on the live socket. The original
    // `server.use` middleware only ran at handshake time, so an access
    // token that expired DURING a long-lived connection kept the socket
    // attached forever (and any permission change — staff demote, freeze
    // — wouldn't reach the in-memory `socket.data.isStaff` flag). Every
    // 60s we re-extract the auth token, verify it (signature + Zod
    // claims), and disconnect on any failure. Clients reconnect with the
    // fresh access token from `wallet.auth-changed` so this is invisible
    // to users with valid sessions.
    const reverifyInterval = setInterval(async () => {
      try {
        const token = extractSocketToken(socket);
        if (!token) throw new Error("MISSING_TOKEN");
        await verifyAccessToken(token);
      } catch (err) {
        logger.debug(
          { sid: socket.id, userId: data.userId, err: err instanceof Error ? err.message : err },
          "socket disconnecting on token re-verify failure",
        );
        socket.emit("auth:expired");
        socket.disconnect(true);
      }
    }, 60_000);
    socket.on("disconnect", () => clearInterval(reverifyInterval));

    socket.on("subscribe", async (payload: unknown) => {
      const obj = payload as { rooms?: string[] } | null;
      const rooms = (obj?.rooms ?? []).filter((r) => typeof r === "string" && ALLOWED_ROOM_RE.test(r));
      for (const r of rooms) {
        // P1 — enforce per-room ACL HERE, not at the REST layer. Previously
        // any authenticated socket could subscribe to ANY `chat:thread:<id>`
        // and receive `chat:message.new` metadata for other members' chats
        // (a real IDOR via the realtime channel). Staff bypass via
        // `chat:staff`; everyone else must own the thread.
        if (r.startsWith("chat:thread:")) {
          if (data.isStaff) {
            socket.join(r);
            continue;
          }
          const threadId = r.slice("chat:thread:".length);
          try {
            const [row] = await db
              .select({ userId: chatThreads.userId })
              .from(chatThreads)
              .where(eq(chatThreads.id, threadId))
              .limit(1);
            if (row && row.userId === data.userId) {
              socket.join(r);
            } else {
              logger.debug(
                { userId: data.userId, threadId },
                "socket subscribe denied: thread ACL",
              );
            }
          } catch (err) {
            logger.warn({ err, room: r }, "socket subscribe ACL lookup failed");
          }
        } else if (r === `user:${data.userId}` || r === "chat:staff") {
          // staff-only rooms are already gated by the regex; user rooms are
          // self-scoped (`user:<own-id>` matches only the caller).
          if (r === "chat:staff" && !data.isStaff) continue;
          socket.join(r);
        }
      }
    });

    socket.on("unsubscribe", (payload: unknown) => {
      const obj = payload as { rooms?: string[] } | null;
      for (const r of obj?.rooms ?? []) socket.leave(r);
    });
  });

  io = server;
  return server;
}

export function getIo(): IoServer | null {
  return io;
}

// ---------- Emitters (called from services) ----------

export function emitNotification(userId: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit("notification", payload);
}

export function emitUnreadCount(userId: string, count: number): void {
  io?.to(`user:${userId}`).emit("notification:count", { count });
}

export function emitChatThreadUpdated(threadId: string): void {
  io?.to(`chat:thread:${threadId}`).emit("chat:thread.updated", { threadId });
  io?.to("chat:staff").emit("chat:list.changed", { threadId });
}

export function emitChatMessageNew(
  threadId: string,
  message: { id: string; threadId: string; senderRole: string; createdAt: string },
): void {
  io?.to(`chat:thread:${threadId}`).emit("chat:message.new", message);
  io?.to("chat:staff").emit("chat:list.changed", { threadId });
}

export function emitChatPcrChanged(threadId: string, requestId: string): void {
  io?.to(`chat:thread:${threadId}`).emit("chat:pcr.changed", { threadId, requestId });
}
