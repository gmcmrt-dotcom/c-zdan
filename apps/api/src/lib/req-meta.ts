import type { Request } from "express";

export function clientIp(req: Request): string | null {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0]!.trim();
  if (Array.isArray(xff) && xff[0]) return xff[0]!.split(",")[0]!.trim();
  return (req.headers["cf-connecting-ip"] as string) ?? (req.headers["x-real-ip"] as string) ?? req.ip ?? null;
}

export function userAgent(req: Request): string | null {
  return (req.headers["user-agent"] as string | undefined) ?? null;
}

export function cfCountry(req: Request): string | null {
  return (req.headers["cf-ipcountry"] as string | undefined) ?? null;
}
