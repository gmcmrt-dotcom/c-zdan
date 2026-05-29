/**
 * Native database query helper.
 *
 *   const rows = await dbSelect<Notif>("notifications", {
 *     cols: "id, title, body, created_at",
 *     where: { user_id: uid, dismissed_at: null },
 *     order: { col: "created_at", asc: false },
 *     limit: 100,
 *   });
 *
 * All methods throw `ApiError` on non-2xx. Wire format: POST /from/<table>
 * with the body shape defined in apps/api/src/routes/from.routes.ts (which
 * decides which tables/columns are allowed and how they're scoped).
 */
import { apiPost } from "./api";

export type WhereOp = "eq" | "neq" | "in" | "gt" | "gte" | "lt" | "lte";

export interface WhereCondition {
  col: string;
  op: WhereOp;
  val: unknown;
}

export type WhereInput =
  /** Object shorthand: `{ col: val }` is treated as `eq`. `null` becomes `IS NULL`. */
  | Record<string, unknown>
  /** Verbose array form when you need ops other than `eq`. */
  | WhereCondition[];

export interface SelectOpts {
  /** Comma-separated column list. Defaults to `*`. */
  cols?: string;
  where?: WhereInput;
  /** PostgREST-style OR clauses, e.g. `"first_name.ilike.%foo%,email.ilike.%foo%"`. */
  or?: string[];
  order?: { col: string; asc?: boolean };
  limit?: number;
  offset?: number;
  /** Inclusive zero-based range; sets offset+limit internally. */
  range?: { from: number; to: number };
}

export interface CountOpts {
  where?: WhereInput;
  or?: string[];
  /** "exact" is most common; "estimated" is faster but approximate. */
  mode?: "exact" | "planned" | "estimated";
}

type ApiEnvelope<T> = { data: T; error: { code: string; message: string } | null; count?: number };

function normaliseWhere(w?: WhereInput): WhereCondition[] | undefined {
  if (!w) return undefined;
  if (Array.isArray(w)) return w;
  return Object.entries(w).map(([col, val]) => ({ col, op: "eq", val }));
}

async function callFrom<T>(
  table: string,
  body: Record<string, unknown>,
): Promise<{ data: T; count?: number }> {
  const res = await apiPost<ApiEnvelope<T>>(`/from/${table}`, body);
  if (res.error) {
    const err = new Error(res.error.message || res.error.code) as Error & { code?: string };
    err.code = res.error.code;
    throw err;
  }
  return { data: res.data, count: res.count };
}

/** Returns a list of rows (empty array if none). */
export async function dbSelect<T = Record<string, unknown>>(
  table: string,
  opts: SelectOpts = {},
): Promise<T[]> {
  const body: Record<string, unknown> = {
    op: "select",
    cols: opts.cols ?? "*",
    where: normaliseWhere(opts.where),
    or: opts.or,
    order: opts.order,
    limit: opts.limit,
    offset: opts.offset,
  };
  if (opts.range) {
    body.offset = opts.range.from;
    body.limit = opts.range.to - opts.range.from + 1;
  }
  const { data } = await callFrom<T[]>(table, body);
  return data ?? [];
}

/** Returns the single matching row or `null` if not found. */
export async function dbSelectMaybeOne<T = Record<string, unknown>>(
  table: string,
  opts: SelectOpts = {},
): Promise<T | null> {
  const body: Record<string, unknown> = {
    op: "select",
    cols: opts.cols ?? "*",
    where: normaliseWhere(opts.where),
    or: opts.or,
    order: opts.order,
    limit: 1,
    maybeSingle: true,
  };
  const { data } = await callFrom<T | null>(table, body);
  return data ?? null;
}

/** Like `dbSelectMaybeOne` but throws if no row is found. */
export async function dbSelectOne<T = Record<string, unknown>>(
  table: string,
  opts: SelectOpts = {},
): Promise<T> {
  const body: Record<string, unknown> = {
    op: "select",
    cols: opts.cols ?? "*",
    where: normaliseWhere(opts.where),
    or: opts.or,
    order: opts.order,
    limit: 1,
    single: true,
  };
  const { data } = await callFrom<T>(table, body);
  return data;
}

/** HEAD-style count query (no rows returned). */
export async function dbCount(table: string, opts: CountOpts = {}): Promise<number> {
  const body: Record<string, unknown> = {
    op: "select",
    cols: "*",
    where: normaliseWhere(opts.where),
    or: opts.or,
    count: opts.mode ?? "exact",
    head: true,
  };
  const { count } = await callFrom<unknown>(table, body);
  return count ?? 0;
}

/** Insert one or many rows; returns the inserted row(s). */
export async function dbInsert<T = Record<string, unknown>>(
  table: string,
  values: Record<string, unknown> | Record<string, unknown>[],
): Promise<T> {
  const { data } = await callFrom<T>(table, { op: "insert", values });
  return data;
}

/** Update rows matching `where`; returns the affected rows. */
export async function dbUpdate<T = Record<string, unknown>>(
  table: string,
  values: Record<string, unknown>,
  where: WhereInput,
): Promise<T> {
  const { data } = await callFrom<T>(table, {
    op: "update",
    values,
    where: normaliseWhere(where),
  });
  return data;
}

/** Delete rows matching `where`. */
export async function dbDelete(table: string, where: WhereInput): Promise<void> {
  await callFrom<unknown>(table, { op: "delete", where: normaliseWhere(where) });
}

/** Aggregate export so callers can `import { db } from "@/lib/db"`. */
export const db = {
  select: dbSelect,
  selectOne: dbSelectOne,
  selectMaybeOne: dbSelectMaybeOne,
  count: dbCount,
  insert: dbInsert,
  update: dbUpdate,
  delete: dbDelete,
};
