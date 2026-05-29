import bcrypt from "bcryptjs";

const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Cheap pre-validation; full enforcement happens in the zod DTO too. */
export function isStrongPassword(p: string): boolean {
  if (p.length < 8 || p.length > 72) return false;
  // require a letter + digit; same rule the legacy `Profile.tsx` used.
  return /[a-zA-Z]/.test(p) && /\d/.test(p);
}
