-- K1 — Drop geo enrichment columns from user_login_ips (Q16 decision).
--
-- Rationale: the previous shape called ipapi.co on every recordLogin,
-- leaking the source IP to a 3rd party with no PII contract, adding a 3s
-- latency budget to every login refresh, and bloating the row with fields
-- that no admin UI actually rendered. UA-derived columns
-- (device_type, browser, os, os_version) stay because they parse locally.
--
-- Note: `/api/from/user_login_ips` continues to return `country` /
-- `country_code` / `city` / `region` as `null` for one release so existing
-- admin BO pages don't error on missing keys.

ALTER TABLE user_login_ips DROP COLUMN IF EXISTS country;
ALTER TABLE user_login_ips DROP COLUMN IF EXISTS country_code;
ALTER TABLE user_login_ips DROP COLUMN IF EXISTS city;
ALTER TABLE user_login_ips DROP COLUMN IF EXISTS region;
