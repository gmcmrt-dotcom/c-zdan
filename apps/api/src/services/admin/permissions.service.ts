/**
 * Admin BO user permission override RPCs (K5 / P0-32).
 */
import { and, eq } from "drizzle-orm";
import { db, tx } from "../../db/client";
import { boPermissions, userPermissionOverrides, userRoles } from "../../db/schema";
import { BadRequestError, NotFoundError } from "../../lib/errors";
import { revokeAllForUser } from "../../auth/sessions";
import { writeAudit } from "./audit";

async function assertStaffTarget(userId: string) {
  const [role] = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, userId))
    .limit(1);
  if (!role) throw new NotFoundError("STAFF_USER_NOT_FOUND");
}

async function roleGrantsPermission(userId: string, resource: string, action: string): Promise<boolean> {
  const rows = await db
    .select({ granted: boPermissions.granted })
    .from(userRoles)
    .innerJoin(
      boPermissions,
      and(eq(boPermissions.role, userRoles.role), eq(boPermissions.resource, resource), eq(boPermissions.action, action)),
    )
    .where(eq(userRoles.userId, userId));
  return rows.some((r) => r.granted);
}

export async function setUserOverride(opts: {
  actorId: string;
  userId: string;
  resource: string;
  action: string;
  granted: boolean;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}) {
  if (opts.userId === opts.actorId && opts.granted) {
    throw new BadRequestError("SELF_ELEVATION_DENIED");
  }
  await assertStaffTarget(opts.userId);

  return tx(async (trx) => {
    const hadRoleGrant = await roleGrantsPermission(opts.userId, opts.resource, opts.action);
    const elevates = opts.granted && !hadRoleGrant;

    const [row] = await trx
      .insert(userPermissionOverrides)
      .values({
        userId: opts.userId,
        resource: opts.resource,
        action: opts.action,
        granted: opts.granted,
        reason: opts.reason ?? null,
        createdBy: opts.actorId,
      })
      .onConflictDoUpdate({
        target: [userPermissionOverrides.userId, userPermissionOverrides.resource, userPermissionOverrides.action],
        set: {
          granted: opts.granted,
          reason: opts.reason ?? null,
          createdBy: opts.actorId,
        },
      })
      .returning({ id: userPermissionOverrides.id });

    if (elevates) {
      await revokeAllForUser(opts.userId, trx);
    }

    await writeAudit({
      actorId: opts.actorId,
      action: "permissions.user_override_set",
      resourceType: "user_permission_override",
      resourceId: row?.id ?? opts.userId,
      after: {
        user_id: opts.userId,
        resource: opts.resource,
        action: opts.action,
        granted: opts.granted,
        reason: opts.reason ?? null,
        sessions_revoked: elevates,
      },
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
      trx,
    });
    return { success: true };
  });
}

export async function removeUserOverride(opts: {
  actorId: string;
  userId: string;
  resource: string;
  action: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  await assertStaffTarget(opts.userId);

  return tx(async (trx) => {
    const [deleted] = await trx
      .delete(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.userId, opts.userId),
          eq(userPermissionOverrides.resource, opts.resource),
          eq(userPermissionOverrides.action, opts.action),
        ),
      )
      .returning({ id: userPermissionOverrides.id });

    if (!deleted) throw new NotFoundError("OVERRIDE_NOT_FOUND");

    await writeAudit({
      actorId: opts.actorId,
      action: "permissions.user_override_remove",
      resourceType: "user_permission_override",
      resourceId: deleted.id,
      before: {
        user_id: opts.userId,
        resource: opts.resource,
        action: opts.action,
      },
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
      trx,
    });
    return { success: true };
  });
}
