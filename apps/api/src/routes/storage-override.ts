/**
 * Storage-override permission check (H1).
 *
 * Used by the public token-gated read endpoint to decide whether a staff
 * user can fetch an owner-locked signed URL signed for a different user.
 * Kept in its own module so the import graph in `storage.routes.ts` stays
 * clean (we lazy-import here from the read handler).
 */
import { db } from "../db/client";
import { eq, inArray } from "drizzle-orm";
import { boPermissions, userRoles } from "../db/schema";

const STAFF_OVERRIDE_PERMS = ["chat:view_all", "chat:reply", "chat:approve_pcr"] as const;

export async function isStaffStorageOverride(userId: string): Promise<boolean> {
  // Resolve the user's roles → look up perms for those roles → see if any
  // grant one of the override keys. Mirror of the request-scoped `req.perms`
  // logic but standalone (the storage read endpoint has no `loadUserPerms`
  // middleware because it's also the public stream endpoint).
  const roles = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));
  if (roles.length === 0) return false;
  const roleNames = roles.map((r) => r.role);
  const perms = await db
    .select({ resource: boPermissions.resource, action: boPermissions.action })
    .from(boPermissions)
    .where(inArray(boPermissions.role, roleNames as ("admin" | "accounting" | "support")[]));
  return perms.some((p) =>
    (STAFF_OVERRIDE_PERMS as readonly string[]).includes(`${p.resource}:${p.action}`),
  );
}
