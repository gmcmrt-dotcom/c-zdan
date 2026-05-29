import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import {
  chatAttachmentStatus,
  chatCategory,
  chatPcrField,
  chatPcrStatus,
  chatSenderRole,
  chatThreadStatus,
} from "./_enums";

export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicNo: text("public_no").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: chatCategory("category").notNull().default("general"),
    subject: text("subject").notNull(),
    status: chatThreadStatus("status").notNull().default("open"),
    relatedTxPublicNo: text("related_tx_public_no"),
    claimedByStaffId: uuid("claimed_by_staff_id").references(() => users.id, {
      onDelete: "set null",
    }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chat_threads_public_no_unique").on(t.publicNo),
    index("chat_threads_user_idx").on(t.userId, t.updatedAt.desc()),
    index("chat_threads_status_idx").on(t.status, t.updatedAt.desc()),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    senderRole: chatSenderRole("sender_role").notNull(),
    senderUserId: uuid("sender_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    cannedResponseId: uuid("canned_response_id"),
    feedbackScore: integer("feedback_score"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_messages_thread_idx").on(t.threadId, t.createdAt.desc())],
);

export const chatCannedResponses = pgTable("chat_canned_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  category: chatCategory("category").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  triggerKeywords: text("trigger_keywords").array().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatRoutingRules = pgTable(
  "chat_routing_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: chatCategory("category").notNull(),
    tgChannelRef: text("tg_channel_ref"),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("chat_routing_rules_category_unique").on(t.category)],
);

export const chatAttachments = pgTable(
  "chat_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => chatMessages.id, { onDelete: "set null" }),
    uploaderUserId: uuid("uploader_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    status: chatAttachmentStatus("status").notNull().default("uploaded"),
    scanResult: jsonb("scan_result").$type<unknown>(),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_attachments_thread_idx").on(t.threadId, t.createdAt.desc())],
);

export const chatProfileChangeRequests = pgTable(
  "chat_profile_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    field: chatPcrField("field").notNull(),
    newValue: text("new_value").notNull(),
    // J1 — Snapshot of the value at request-creation time. Without this,
    // a reviewer 4 days later has no idea what the change-from value was,
    // and the audit chain `request → apply` can't be diffed in the UI.
    // Populated by `chatCreateProfileChangeRequest`; nullable for historical
    // rows. Masked at storage for email/phone via the redactor.
    oldValue: text("old_value"),
    status: chatPcrStatus("status").notNull().default("pending"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_pcr_user_idx").on(t.userId, t.createdAt.desc())],
);
