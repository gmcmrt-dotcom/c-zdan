import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./client";
import { logger } from "../lib/logger";

async function main() {
  logger.info("running migrations…");
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  logger.info("migrations complete");
  await sql.end();
}

main().catch((err) => {
  logger.error({ err }, "migration failed");
  process.exit(1);
});
