/**
 * Native realtime subscriptions.
 *
 *   const unsub = subscribeRoom("admin-chat-threads", {
 *     "chat:thread.updated": () => reload(),
 *     "chat:message.new":    (payload) => append(payload),
 *   });
 *   // later:
 *   unsub();
 *
 * Joins the named Socket.IO room and dispatches events to handlers. Calling
 * the returned function removes the event listeners and leaves the room.
 */
import { getSocket, subscribeRoom as joinRoom, unsubscribeRoom as leaveRoom } from "./socket";

export type EventHandlers = Record<string, (payload: unknown) => void>;

/**
 * Subscribe to a room and bind event handlers. Returns an unsubscribe function
 * which removes the listeners AND leaves the room.
 *
 * Multiple subscriptions to the same room are fine — the underlying socket
 * tracks a single membership and listeners are scoped per subscriber.
 */
export function subscribeRoom(room: string, handlers: EventHandlers): () => void {
  const sock = getSocket();
  joinRoom(room);
  const offFns: Array<() => void> = [];
  for (const [event, cb] of Object.entries(handlers)) {
    const wrapped = (payload: unknown) => cb(payload);
    sock.on(event, wrapped);
    offFns.push(() => sock.off(event, wrapped));
  }
  return () => {
    for (const off of offFns.splice(0)) off();
    leaveRoom(room);
  };
}

/** One-off event listener helper — returns the unbind callback. */
export function onEvent<T = unknown>(
  event: string,
  handler: (payload: T) => void,
): () => void {
  const sock = getSocket();
  const wrapped = (payload: unknown) => handler(payload as T);
  sock.on(event, wrapped);
  return () => sock.off(event, wrapped);
}
