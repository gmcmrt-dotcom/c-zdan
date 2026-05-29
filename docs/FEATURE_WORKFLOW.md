# New feature — contract-first flow

1. **Page contract** — read `docs/PAGE_CONTRACTS.md`; if your change conflicts with an existing contract, raise it with the user before touching code.
2. **Hard rules** — read `docs/HARD_RULES.md` (#7 no merchant name, #8 no member fee, #1 idempotency, #8.1 net merchant accounting).
3. **Money flow** — if the work touches deposit / withdraw / spend / credit, re-read the relevant flow in `docs/ARCHITECTURE_FLOWS.md`.
4. **Plan (3–5 lines)** → confirm with the user → write code.
5. **Admin BO page?** → follow `docs/ADMIN_BO_REGISTRY.md` and update `apps/web/src/lib/admin-bo-registry.ts`.
6. **DB change?** → add / edit the schema in `apps/api/src/db/schema/`, then `npm --workspace apps/api run db:generate`, review the SQL, `npm run db:migrate`. See `docs/DEPLOY_WORKFLOW.md`.
7. **Page contract back-fill** — add the new page (or amended bullets for an existing one) to `docs/PAGE_CONTRACTS.md` in the same commit.
8. **Verify** — `npm run typecheck`, `npm run lint`, `npm --workspace apps/api test`, and — if the API is running — `node scripts/smoke-all.mjs`.

## Admin BO short checklist

- `apps/web/src/lib/admin-bo-registry.ts` — module entry + nav + `sensitiveItems`.
- `apps/web/src/App.tsx` — route + lazy import + `<StaffLazy>` wrapper.
- `AdminLayout` — `requireAny={["resource:view"]}` matches the registry.
- `apps/api/src/db/seed.ts` — add the new `bo_permissions` rows (admin/accounting/support).
- `apps/api/src/routes/admin.routes.ts` (or a new admin service) — server-side handler with `requireStaff` + permission check.
- Re-run `npm run db:seed` after seeding new permissions.
