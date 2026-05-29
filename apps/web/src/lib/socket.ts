/**
 * Singleton Socket.IO client. Authenticates via the HttpOnly `access_token`
 * cookie (set by /auth/login + /auth/refresh) which rides automatically on
 * the WebSocket upgrade thanks to `withCredentials: true`. Re-subscribes
 * to active rooms on reconnect; re-creates the socket on auth changes
 * (login/logout/refresh) so a fresh cookie value is picked up.
 *
 * O regression — pre-Batch O the client passed the access token in
 * `auth.token`, but post-Batch O `getAccessToken()` returns "" in normal
 * operation (the token is HttpOnly). The handshake now relies on the
 * cookie + the server-side cookie parser in realtime/server.ts.
 */
import { io, Socket } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "/ws";
const SOCKET_PATH = SOCKET_URL.startsWith("http") || SOCKET_URL.startsWith("ws")
  ? "/ws"
  : SOCKET_URL;

let socket: Socket | null = null;
const subscribedRooms = new Set<string>();

function ensureSocket(): Socket {
  if (socket && socket.connected) return socket;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  socket = io({
    path: SOCKET_PATH,
    // O.2 — send cookies on the WebSocket upgrade so the server-side
    // handshake middleware can read `access_token` from the cookie header.
    withCredentials: true,
    autoConnect: true,
    reconnection: true,
  });
  socket.on("connect", () => {
    if (subscribedRooms.size > 0) {
      socket?.emit("subscribe", { rooms: Array.from(subscribedRooms) });
    }
  });
  return socket;
}

export function getSocket(): Socket {
  return ensureSocket();
}

export function subscribeRoom(room: string): void {
  subscribedRooms.add(room);
  const s = ensureSocket();
  if (s.connected) s.emit("subscribe", { rooms: [room] });
}

export function unsubscribeRoom(room: string): void {
  subscribedRooms.delete(room);
  socket?.emit("unsubscribe", { rooms: [room] });
}

export function onEvent<T = unknown>(event: string, handler: (payload: T) => void): () => void {
  const s = ensureSocket();
  s.on(event, handler as never);
  return () => s.off(event, handler as never);
}

window.addEventListener("wallet.auth-changed", () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
});
