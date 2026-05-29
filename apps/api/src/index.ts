import { createServer } from "node:http";
import { buildApp } from "./app";
import { env } from "./lib/env";
import { logger } from "./lib/logger";
import { buildIo } from "./realtime/server";
import { startScheduler } from "./workers/scheduler";
import { sql as pgClient } from "./db/client";

const app = buildApp();
const httpServer = createServer(app);
const io = buildIo(httpServer);

const server = httpServer.listen(env.PORT, env.HOST, () => {
  logger.info(`API listening on http://${env.HOST}:${env.PORT} (ws: /ws)`);
  if (process.env.START_SCHEDULER !== "false") startScheduler();
});

/**
 * P1 — Graceful shutdown.
 *
 * The previous implementation only called `server.close` and then forced
 * exit after 10s — leaving Socket.IO clients hanging, leaking in-flight DB
 * connections, and not stopping the scheduler. The new sequence:
 *   1. Stop accepting new HTTP / WS connections.
 *   2. Disconnect every Socket.IO client cleanly.
 *   3. Drain the Drizzle / postgres-js pool so no half-written tx is left.
 *   4. Hard-exit if drain takes longer than the budget.
 */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");

  // Kill switch — never let this hang forever.
  const hardExit = setTimeout(() => {
    logger.error("shutdown took too long, force exit");
    process.exit(1);
  }, 15_000);
  hardExit.unref();

  try {
    // Tell the listener we're done; in-flight requests still complete.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Bounce every socket so clients reconnect to a healthy node.
    try {
      io.disconnectSockets(true);
      await new Promise<void>((resolve) => io.close(() => resolve()));
    } catch (err) {
      logger.warn({ err }, "socket.io close failed");
    }
    // Drain the DB pool.
    try {
      await pgClient.end({ timeout: 5 });
    } catch (err) {
      logger.warn({ err }, "pg pool drain failed");
    }
    clearTimeout(hardExit);
    logger.info("shutdown complete");
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "shutdown error");
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
