# Wallet — agent entry point

1. **`CLAUDE.md`** — session-start core (read first, ~80 lines)
2. **`docs/SESSION_STATUS.md`** — open work + current state
3. **`docs/INDEX.md`** — topic → which doc

Stack at a glance: **Node 20 · Express · Drizzle · PostgreSQL 16 · Vite + React 18 · Socket.IO**.

Monorepo layout:

```
apps/web         Vite React app  (was ./src/)
apps/api         Express API server
packages/shared  zod DTO + types
```

End-to-end smoke (against `npm run dev`): `node scripts/smoke-all.mjs`.

**Production deploy:** Sohbette `+` / `deploy` / `sunucuya gönder` → agent onay sonrası `npm run deploy` çalıştırır. Kurulum: `docs/DEPLOY_PLUS.md`.
