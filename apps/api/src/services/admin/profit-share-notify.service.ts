/**
 * PS5 — profit-share publish notifications (email + in-app + optional push stub).
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/client";
import { notifications } from "../../db/schema";
import { corsOrigins, env, isDev } from "../../lib/env";
import { profitSharePublishedTemplate, sendEmail } from "../../lib/email";
import { logger } from "../../lib/logger";
import { emitNotification } from "../../realtime/server";

function memberClaimUrl(): string {
  const base = corsOrigins[0] ?? "http://localhost:8080";
  return `${base.replace(/\/$/, "")}/profit-share`;
}

function formatTry(amount: number): string {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(amount);
}

function formatExpiresAt(iso: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export async function notifyProfitShareCampaignPublished(opts: {
  campaignId: string;
  expiresAt: Date;
}): Promise<{ notified: number; emailsSent: number; pushStubbed: number }> {
  const expiresIso = opts.expiresAt.toISOString();
  const claimUrl = memberClaimUrl();

  const rows = await db.execute<{
    allocation_id: string;
    user_id: string;
    email: string | null;
    first_name: string | null;
    allocated_amount: string;
  }>(sql`
    SELECT
      a.id AS allocation_id,
      a.user_id,
      u.email,
      p.first_name,
      a.allocated_amount::text
    FROM profit_share_allocations a
    INNER JOIN users u ON u.id = a.user_id
    LEFT JOIN profiles p ON p.id = a.user_id
    WHERE a.campaign_id = ${opts.campaignId}
      AND a.status = 'pending'
  `);

  const recipients = rows as unknown as Array<{
    allocation_id: string;
    user_id: string;
    email: string | null;
    first_name: string | null;
    allocated_amount: string;
  }>;

  let emailsSent = 0;
  let pushStubbed = 0;

  for (const r of recipients) {
    const amount = Number(r.allocated_amount);
    const amountLabel = formatTry(amount);
    const expiresLabel = formatExpiresAt(expiresIso);

    const [n] = await db
      .insert(notifications)
      .values({
        userId: r.user_id,
        category: "profit_share",
        titleTr: "Kazanç payın hazır",
        bodyTr: `${amountLabel} kazanç payın tanımlandı. Süre dolmadan bakiyene aktar.`,
        titleEn: "Your profit share is ready",
        bodyEn: `${amountLabel} profit share allocated. Claim before it expires.`,
        linkUrl: "/profit-share",
        metadata: {
          campaign_id: opts.campaignId,
          allocation_id: r.allocation_id,
          allocated_amount: amount,
          expires_at: expiresIso,
        },
      })
      .returning({
        id: notifications.id,
        category: notifications.category,
        titleTr: notifications.titleTr,
        bodyTr: notifications.bodyTr,
        createdAt: notifications.createdAt,
      });

    if (n) {
      emitNotification(r.user_id, {
        id: n.id,
        category: n.category,
        title: n.titleTr,
        body: n.bodyTr,
        createdAt: n.createdAt.toISOString(),
        linkUrl: "/profit-share",
      });
    }

    if (r.email) {
      const tpl = profitSharePublishedTemplate({
        name: r.first_name,
        amount: amountLabel,
        expiresAt: expiresLabel,
        claimUrl,
      });
      const result = await sendEmail({
        to: r.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
      if (result.ok) {
        emailsSent++;
      } else if (result.error === "EMAIL_NOT_CONFIGURED") {
        if (isDev) {
          logger.warn(
            {
              userId: r.user_id,
              emailDomain: r.email.split("@")[1],
              amount: amountLabel,
              claimUrl,
            },
            "DEV-ONLY profit-share email (SMTP not configured)",
          );
        } else {
          logger.debug({ userId: r.user_id }, "profit-share email skipped (no transport)");
        }
      } else {
        logger.warn({ userId: r.user_id, err: result.error }, "profit-share email failed");
      }
    }

    if (env.PUSH_NOTIFICATIONS_ENABLED) {
      pushStubbed++;
      logger.info(
        { userId: r.user_id, allocationId: r.allocation_id, amount },
        "push stub: profit_share_published",
      );
    }
  }

  return { notified: recipients.length, emailsSent, pushStubbed };
}

/** Fire-and-forget wrapper — publish RPC must not block on SMTP. */
export function scheduleProfitSharePublishNotifications(opts: {
  campaignId: string;
  expiresAt: Date;
}): void {
  setImmediate(() => {
    void notifyProfitShareCampaignPublished(opts).catch((err) => {
      logger.warn({ err, campaignId: opts.campaignId }, "profit-share publish notifications failed");
    });
  });
}
