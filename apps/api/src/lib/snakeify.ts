/**
 * Recursively convert camelCase keys → snake_case for legacy frontend pages
 * that expect Supabase/PostgREST-style payloads.
 *
 *  - Dates → ISO strings
 *  - Arrays are mapped element-wise
 *  - BigInt → string (Postgres bigserial PKs)
 *  - Plain objects: every key is rewritten
 *  - Other primitives passed through unchanged
 */
function snakeKey(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

export function snakeify<T = unknown>(v: unknown): T {
  if (v === null || v === undefined) return v as T;
  if (typeof v === "bigint") return String(v) as unknown as T;
  if (Array.isArray(v)) return v.map((i) => snakeify(i)) as unknown as T;
  if (v instanceof Date) return v.toISOString() as unknown as T;
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[snakeKey(k)] = snakeify(val);
    }
    return out as T;
  }
  return v as T;
}
