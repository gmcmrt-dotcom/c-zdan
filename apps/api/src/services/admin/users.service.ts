/**
 * Admin user provisioning (port of admin-user-create edge fn).
 *
 * Scopes:
 *  - "admin_bo"   → creates an auth user + profile, allows attaching user_roles after
 *  - "merchant"   → creates an auth user (merchant_users row added separately)
 *  - "affiliate"  → creates an auth user (merchant_affiliates row added separately)
 */
import { eq, sql } from "drizzle-orm";
import { db, tx } from "../../db/client";
import { accounts, merchantUsers, profiles, userRoles, users } from "../../db/schema";
import { hashPassword } from "../../auth/passwords";
import { genMemberNo, genReferralCode } from "../../lib/random";
import { ConflictError } from "../../lib/errors";
import { writeAudit } from "./audit";

export type CreateUserScope = "admin_bo" | "merchant" | "affiliate";

export interface CreateUserOpts {
  actorId: string;
  scope: CreateUserScope;
  email: string;
  password: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  targetMerchantId?: string | null;
  /** Optional staff roles to grant after creation. */
  roles?: Array<"admin" | "accounting" | "support">;
  ip?: string | null;
}

export interface CreateUserResult {
  success: true;
  userId: string;
  email: string;
  createdNew: boolean;
}

export async function adminCreateUser(opts: CreateUserOpts): Promise<CreateUserResult> {
  const email = opts.email.trim().toLowerCase();
  return tx(async (trx) => {
    const [existing] = await trx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    let userId: string;
    let createdNew = false;
    if (existing) {
      userId = existing.id;
    } else {
      const passwordHash = await hashPassword(opts.password);
      const [u] = await trx
        .insert(users)
        .values({ email, passwordHash, emailVerifiedAt: new Date() })
        .returning({ id: users.id });
      if (!u) throw new Error("user insert failed");
      userId = u.id;
      createdNew = true;

      const firstName = opts.firstName?.trim() || "User";
      const lastName = opts.lastName?.trim() || "Admin";
      const phone = opts.phone?.trim() || null;
      await trx.insert(profiles).values({
        id: userId,
        email,
        firstName,
        lastName,
        phone,
        memberNo: genMemberNo(),
        referralCode: genReferralCode(),
        emailVerifiedAt: new Date(),
      } as never);
      await trx.insert(accounts).values({ userId });
    }

    // Apply scope side-effects
    if (opts.scope === "admin_bo" && opts.roles?.length) {
      for (const role of opts.roles) {
        await trx
          .insert(userRoles)
          .values({ userId, role })
          .onConflictDoNothing();
      }
    }
    if (opts.scope === "merchant" && opts.targetMerchantId) {
      // Attach as read_only by default; admin can promote later
      const [dup] = await trx
        .select({ id: merchantUsers.id })
        .from(merchantUsers)
        .where(
          sql`${merchantUsers.merchantId} = ${opts.targetMerchantId} AND ${merchantUsers.userId} = ${userId}`,
        )
        .limit(1);
      if (!dup) {
        await trx.insert(merchantUsers).values({
          merchantId: opts.targetMerchantId,
          userId,
          email,
          role: "read_only",
          isActive: true,
        });
      } else {
        // Reactivate
        await trx
          .update(merchantUsers)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(merchantUsers.id, dup.id));
      }
    }

    await writeAudit({
      actorId: opts.actorId,
      action: `admin.create_user.${opts.scope}`,
      resourceType: "user",
      resourceId: userId,
      metadata: {
        email,
        createdNew,
        scope: opts.scope,
        roles: opts.roles ?? [],
        targetMerchantId: opts.targetMerchantId ?? null,
      },
      ip: opts.ip ?? null,
    });

    return { success: true, userId, email, createdNew };
  });
}
