# Admin BO Registry — left nav & sensitive-data centre

Single source of truth: [`apps/web/src/lib/admin-bo-registry.ts`](../apps/web/src/lib/admin-bo-registry.ts)

That file feeds three UI surfaces:

| Surface | Function |
|---------|----------|
| Admin left nav | `getAdminNavGroups()` → `AdminLayout` |
| Permissions → module access | `getPermissionModules()` → `/admin/permissions` |
| Permissions → sensitive data | `getSensitiveByPage()` → accordion |

## Checklist for a new module

1. **`ADMIN_MODULES`** — module entry + `sensitiveItems` (PII, API key, URL, …).
2. **`ADMIN_NAV_GROUPS_ALL`** — left-nav row (`moduleKey` must match).
3. **Admin page** — `requireAny={["<resource>:view"]}` matches the registry.
4. **`apps/web/src/App.tsx`** — lazy import + route wrapped in `<StaffLazy>`.
5. **`apps/api/src/db/seed.ts`** — add the new permission rows under the relevant role(s).
6. **`apps/api/src/routes/admin.routes.ts`** — server handler protected by `requireStaff` + permission check (see `permission.ts`).
7. **Re-seed:** `npm run db:seed` to materialise the new permissions.

## Feature-flagged module

Example: affiliate (`VITE_AFFILIATE_ENABLED`).

- `getAdminNavGroups()` and `validateAdminBoRegistry()` filter the module out when the flag is off.
- The `ADMIN_MODULES` entry stays in place (ready when the flag flips on).
- Affiliate routes in `App.tsx` are wrapped in `<AffiliateLazy>` which calls `isAffiliateEnabled()` from `apps/web/src/lib/feature-flags.ts`.

## Icons

Top of `admin-bo-registry.ts` imports the Lucide icons used by the nav. Pick an
existing import or add a new one when introducing a module.

## Detail pages (no nav entry)

These pages share a parent module's permission rather than getting their own
nav row:

- `MemberDetail.tsx` → `members`
- `MerchantDetailPage.tsx` → `merchants`
- `BOUserDetailPage.tsx` → `bo_users`
- `MerchantChildren.tsx` → `merchant_children`
- `ProviderDetailPage.tsx` / `MethodDetailPage.tsx` → kept for the merchant-method drill-down

`Onboarding.tsx` is a back-compat route — intentionally absent from the registry.
