/**
 * RBAC middleware — replaces `has_permission()` RPC + RLS.
 *
 * Looks up the user's effective permission set (union of role-derived
 * `bo_permissions` minus per-user `user_permission_overrides` denials, plus
 * per-user grants), caches per-request, and rejects with FORBIDDEN.
 */
import type { RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { ForbiddenError, UnauthorizedError } from "../lib/errors";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      perms?: Set<string>;
    }
  }
}

async function loadPerms(userId: string): Promise<Set<string>> {
  const rows = await db.execute<{ resource: string; action: string }>(sql`
    WITH role_perms AS (
      SELECT bp.resource, bp.action
      FROM bo_permissions bp
      JOIN user_roles ur ON ur.role = bp.role
      WHERE ur.user_id = ${userId} AND bp.granted = TRUE
    ),
    overrides AS (
      SELECT resource, action, granted
      FROM user_permission_overrides WHERE user_id = ${userId}
    )
    SELECT DISTINCT resource, action FROM role_perms
    WHERE NOT EXISTS (
      SELECT 1 FROM overrides o
      WHERE o.resource = role_perms.resource AND o.action = role_perms.action AND o.granted = FALSE
    )
    UNION
    SELECT resource, action FROM overrides WHERE granted = TRUE
  `);
  const set = new Set<string>();
  for (const r of rows as unknown as Array<{ resource: string; action: string }>) {
    set.add(`${r.resource}:${r.action}`);
  }
  return set;
}

export function can(req: Express.Request, resource: string, action: string): boolean {
  return req.perms?.has(`${resource}:${action}`) ?? false;
}

/** Express middleware factory: require resource:action. */
export function requirePerm(resource: string, action: string): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.user) throw new UnauthorizedError();
      if (!req.perms) req.perms = await loadPerms(req.user.id);
      if (!req.perms.has(`${resource}:${action}`))
        throw new ForbiddenError("PERMISSION_DENIED");
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Pre-load perms onto req (use once at the admin router root). */
export const loadUserPerms: RequestHandler = async (req, _res, next) => {
  try {
    if (req.user && !req.perms) req.perms = await loadPerms(req.user.id);
    next();
  } catch (err) {
    next(err);
  }
};
