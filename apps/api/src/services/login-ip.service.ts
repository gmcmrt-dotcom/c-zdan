import { UAParser } from "ua-parser-js";
import geoip from "geoip-lite";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { profiles, userLoginIps, users } from "../db/schema";
import { newDeviceLoginTemplate, sendEmail } from "../lib/email";
import { logger } from "../lib/logger";

// K1-r — Geo enrichment via LOCAL geoip-lite (offline MaxMind GeoLite2 DB).
//
// Replaces the previous shape (P1) that called ipapi.co on every
// recordLogin. The new path runs entirely in-process:
//   - no outbound HTTP, no PII leaked to a 3rd party
//   - no latency budget (lookup is a binary-search on a ~30MB in-memory
//     table; ~microseconds per call)
//   - no rate-limit cliff
//
// The geoip-lite npm package ships the GeoLite2 country + region + city
// databases. Refresh quarterly via `npx geoip-lite-update` in CI.
//
// `region` is rarely populated for non-US IPs; `city` is populated only
// when the IP belongs to a known city block. We accept the gaps — the
// useful invariant is `country_code` which is reliable globally.

// J3 — Same 60-min dedup as the prior shape: skip the insert when the
// most recent row for this (user_id, ip, ua) is younger than the window.
const DEDUP_WINDOW_MIN = 60;

type DeviceType = "mobile" | "desktop" | "tablet" | "bot" | "unknown";

function parseUa(ua: string | null): {
  device_type: DeviceType;
  browser: string | null;
  browser_version: string | null;
  os: string | null;
  os_version: string | null;
} {
  if (!ua)
    return {
      device_type: "unknown",
      browser: null,
      browser_version: null,
      os: null,
      os_version: null,
    };
  const r = new UAParser(ua).getResult();
  const t = r.device.type;
  let device_type: DeviceType = "desktop";
  if (t === "mobile") device_type = "mobile";
  else if (t === "tablet") device_type = "tablet";
  else if (ua.toLowerCase().includes("bot") || ua.toLowerCase().includes("spider"))
    device_type = "bot";
  else if (!t) device_type = "desktop";
  return {
    device_type,
    browser: r.browser.name ?? null,
    browser_version: r.browser.version ?? null,
    os: r.os.name ?? null,
    os_version: r.os.version ?? null,
  };
}

interface Geo {
  country: string | null;
  country_code: string | null;
  city: string | null;
  region: string | null;
}

// ISO 3166-1 alpha-2 → English country-name fallback for the most common
// jurisdictions. The country COLUMN stores the human-readable name to
// match the historical shape; the CODE column is the authoritative key.
// Anything not in this map falls back to the bare code (still useful).
const COUNTRY_NAMES: Record<string, string> = {
  TR: "Türkiye",
  US: "United States",
  GB: "United Kingdom",
  DE: "Germany",
  FR: "France",
  NL: "Netherlands",
  IT: "Italy",
  ES: "Spain",
  RU: "Russia",
  UA: "Ukraine",
  PL: "Poland",
  CN: "China",
  JP: "Japan",
  KR: "South Korea",
  IN: "India",
  BR: "Brazil",
  MX: "Mexico",
  CA: "Canada",
  AU: "Australia",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  EG: "Egypt",
  ZA: "South Africa",
  GR: "Greece",
  BG: "Bulgaria",
  RO: "Romania",
  AT: "Austria",
  CH: "Switzerland",
  BE: "Belgium",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  IE: "Ireland",
  PT: "Portugal",
  CZ: "Czech Republic",
  HU: "Hungary",
  IL: "Israel",
  ID: "Indonesia",
  TH: "Thailand",
  VN: "Vietnam",
  PH: "Philippines",
  MY: "Malaysia",
  SG: "Singapore",
  HK: "Hong Kong",
  TW: "Taiwan",
  AR: "Argentina",
  CL: "Chile",
  CO: "Colombia",
  PE: "Peru",
  NZ: "New Zealand",
};

function lookupGeoLocal(ip: string): Geo {
  const empty: Geo = { country: null, country_code: null, city: null, region: null };
  if (!ip) return empty;
  // Skip private / loopback / link-local — geoip-lite returns null for
  // these anyway, but bailing early saves the binary search.
  if (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("169.254.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)
  ) {
    return empty;
  }
  try {
    const r = geoip.lookup(ip);
    if (!r) return empty;
    const code = r.country || null;
    return {
      country: code ? COUNTRY_NAMES[code] ?? code : null,
      country_code: code,
      city: r.city || null,
      region: r.region || null,
    };
  } catch {
    return empty;
  }
}

export interface RecordLoginInput {
  userId: string;
  ip: string | null;
  userAgent: string | null;
  /** Optional Cloudflare CF-IPCountry header. If set and the local geo
   *  lookup didn't return a country code (e.g. unknown range), we fall
   *  back to the CF hint so the row at least has a country. */
  cfCountry?: string | null;
}

export async function recordLogin(input: RecordLoginInput): Promise<{
  ok: true;
  geo: Geo;
  ua: ReturnType<typeof parseUa>;
}> {
  const ua = parseUa(input.userAgent);
  if (!input.ip) {
    return { ok: true, geo: { country: null, country_code: null, city: null, region: null }, ua };
  }

  // J3 — Dedup: skip both the DB insert AND the geo lookup when the same
  // (user, ip, ua) was written in the last 60 min. Cheap one-shot lookup.
  const recent = await db
    .select({ id: userLoginIps.id })
    .from(userLoginIps)
    .where(
      and(
        eq(userLoginIps.userId, input.userId),
        eq(userLoginIps.ipAddress, input.ip),
        gt(userLoginIps.createdAt, new Date(Date.now() - DEDUP_WINDOW_MIN * 60_000)),
        input.userAgent
          ? eq(userLoginIps.userAgent, input.userAgent)
          : sql`${userLoginIps.userAgent} IS NULL`,
      ),
    )
    .orderBy(desc(userLoginIps.createdAt))
    .limit(1);
  if (recent.length > 0) {
    return { ok: true, geo: { country: null, country_code: null, city: null, region: null }, ua };
  }

  const geo = lookupGeoLocal(input.ip);
  // CF fallback: only if the local DB has no country for this IP.
  if (!geo.country_code && input.cfCountry) {
    geo.country_code = input.cfCountry.toUpperCase();
    geo.country = COUNTRY_NAMES[geo.country_code] ?? geo.country_code;
  }

  await db.insert(userLoginIps).values({
    userId: input.userId,
    ipAddress: input.ip,
    userAgent: input.userAgent,
    country: geo.country,
    countryCode: geo.country_code,
    city: geo.city,
    region: geo.region,
    deviceType: ua.device_type,
    browser: ua.browser,
    browserVersion: ua.browser_version,
    os: ua.os,
    osVersion: ua.os_version,
  });

  // Q1 — New-device login email alert (p2-fourth-sweep).
  //
  // The insert above only fires when the J3 60-min dedup misses, i.e. this
  // really is a NEW (user, ip, ua) combination — so the alert can't spam
  // on routine refreshes. We look up the user's email + first name and
  // hand off to `sendEmail` via `setImmediate` so the login response is
  // never blocked by SMTP latency. `sendEmail` is itself graceful: it
  // returns EMAIL_NOT_CONFIGURED when SMTP isn't wired (debug-logged
  // here), so this works in dev (no SMTP) and prod (SMTP configured) the
  // same way.
  setImmediate(() => {
    void sendNewDeviceAlert({
      userId: input.userId,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  });

  return { ok: true, geo, ua };
}

async function sendNewDeviceAlert(args: {
  userId: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  try {
    const [row] = await db
      .select({
        email: users.email,
        firstName: profiles.firstName,
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.id, users.id))
      .where(eq(users.id, args.userId))
      .limit(1);
    if (!row?.email) return;
    const tpl = newDeviceLoginTemplate({
      name: row.firstName ?? null,
      ip: args.ip,
      userAgent: args.userAgent,
      whenIso: new Date().toISOString(),
    });
    const result = await sendEmail({
      to: row.email,
      subject: tpl.subject,
      html: tpl.html,
    });
    if (!result.ok) {
      // EMAIL_NOT_CONFIGURED is the dev / no-SMTP path — keep at debug
      // so production logs aren't noisy if SMTP is intentionally absent.
      const level = result.error === "EMAIL_NOT_CONFIGURED" ? "debug" : "warn";
      logger[level](
        { err: result.error, userId: args.userId },
        "new-device login email skipped",
      );
    }
  } catch (err) {
    // Never let an alert failure surface — login already succeeded and
    // the row is in user_login_ips for post-hoc review.
    logger.warn({ err, userId: args.userId }, "new-device login email failed");
  }
}
