CREATE TABLE IF NOT EXISTS "public_no_counters" (
	"prefix" text NOT NULL,
	"yyyymmdd" text NOT NULL,
	"next" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "public_no_counters_pk" ON "public_no_counters" USING btree ("prefix","yyyymmdd");