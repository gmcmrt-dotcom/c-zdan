-- K1-r — Restore geo columns on user_login_ips (revert of mig 0009).
--
-- Per owner correction: instead of dropping geo, we use a LOCAL
-- IP-to-country database (geoip-lite, bundled MaxMind GeoLite2) with
-- zero outbound network calls. The columns are the same shape they
-- were before mig 0009, but the data path is local — no PII goes to
-- ipapi.co or any 3rd party.
--
-- `region` is rarely populated by GeoLite2 for non-US IPs; `city` is
-- populated when the IP is in a known city block. Both are nullable.

ALTER TABLE user_login_ips ADD COLUMN IF NOT EXISTS country       text;
ALTER TABLE user_login_ips ADD COLUMN IF NOT EXISTS country_code  text;
ALTER TABLE user_login_ips ADD COLUMN IF NOT EXISTS city          text;
ALTER TABLE user_login_ips ADD COLUMN IF NOT EXISTS region        text;
