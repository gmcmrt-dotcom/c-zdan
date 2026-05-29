# `backups/`

This directory is intentionally empty in source control.

Production backups are produced by `deploy/backup.sh.example` (a daily
`pg_dump` cron) and live in `$BACKUP_DIR` (defaults to `/var/backups/wallet`,
mode `0700`, retained `BACKUP_RETENTION_DAYS=14` by default). They are NOT
committed to git.

The previous `pre-v2056-data-20260504-2019.sql` (0-byte placeholder) was
removed in the I4 ship-now batch — its existence gave a misleading
impression that we had checkpoint backups committed here.

## To restore

```bash
gunzip -c /var/backups/wallet/wallet-YYYYMMDDTHHMMSSZ.sql.gz \
  | psql "$DATABASE_URL"
```

## Drill

Run the restore against a scratch database at least quarterly. The
backup script's output line includes `target` / `size_bytes` /
`duration_sec`; ops can wire that into the log aggregator and alert on
size-drop anomalies.
