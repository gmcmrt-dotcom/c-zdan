import { z } from "zod";

const Email = z.string().trim().toLowerCase().email().max(255);
// H1 — Strengthened password policy applied at signup / reset / change. The
// bcrypt cap is 72 bytes; we cap at 72 chars so users don't hit the silent
// truncation. Length ≥12 with at least one lowercase, one uppercase, and
// one digit catches the dictionary entries and 8-char patterns that
// password-spray attacks lean on. Login validation stays at min(1) so
// existing accounts with shorter passwords can still authenticate (the
// policy applies forward-only).
const Password = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(72)
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/\d/, "Password must contain a digit");

const NameField = z
  .string()
  .trim()
  .min(1)
  .max(50);

const PhoneField = z
  .string()
  .trim()
  .regex(/^[0-9]{10}$/, "Phone must be 10 digits (TR mobile, no leading 0)")
  .optional()
  .nullable();

export const SignupRequest = z.object({
  email: Email,
  password: Password,
  firstName: NameField,
  lastName: NameField,
  phone: PhoneField,
  referralCode: z
    .string()
    .trim()
    .toUpperCase()
    .max(12)
    .optional()
    .nullable(),
  userAgent: z.string().optional(),
});
export type SignupRequest = z.infer<typeof SignupRequest>;

export const LoginRequest = z.object({
  email: Email,
  password: z.string().min(1).max(72),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const RefreshRequest = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const LogoutRequest = z.object({
  refreshToken: z.string().optional(),
  allDevices: z.boolean().optional(),
});
export type LogoutRequest = z.infer<typeof LogoutRequest>;

export const ProfileIdentifierExistsRequest = z.object({
  email: Email.optional(),
  phone: PhoneField,
});
export type ProfileIdentifierExistsRequest = z.infer<typeof ProfileIdentifierExistsRequest>;

export const ProfileIdentifierExistsResponse = z.object({
  email_exists: z.boolean(),
  phone_exists: z.boolean(),
});
export type ProfileIdentifierExistsResponse = z.infer<typeof ProfileIdentifierExistsResponse>;

export const TokenPair = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresAt: z.string(),
  refreshExpiresAt: z.string(),
  aal: z.enum(["aal1", "aal2"]),
});
export type TokenPair = z.infer<typeof TokenPair>;

export const MeResponse = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    emailVerified: z.boolean(),
    aal: z.enum(["aal1", "aal2"]),
  }),
  profile: z
    .object({
      memberNo: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      phone: z.string().nullable(),
      kycStatus: z.enum(["none", "pending", "verified", "rejected"]),
      isFrozen: z.boolean(),
      referralCode: z.string().nullable(),
    })
    .nullable(),
  memberships: z.object({
    isStaff: z.boolean(),
    roles: z.array(z.enum(["admin", "accounting", "support"])),
    merchantId: z.string().uuid().nullable(),
    merchantRole: z.enum(["owner", "accountant", "read_only"]).nullable(),
    isAffiliate: z.boolean(),
  }),
  mfa: z.object({
    enabled: z.boolean(),
    required: z.boolean(),
    factorsCount: z.number().int().nonnegative(),
  }),
  permissions: z.array(z.object({ resource: z.string(), action: z.string() })),
});
export type MeResponse = z.infer<typeof MeResponse>;

// MFA
export const MfaEnrollRequest = z.object({
  friendlyName: z.string().min(1).max(64).default("Authenticator"),
});
export type MfaEnrollRequest = z.infer<typeof MfaEnrollRequest>;

export const MfaEnrollResponse = z.object({
  factorId: z.string().uuid(),
  secret: z.string(),
  uri: z.string(),
  qrDataUrl: z.string(),
});
export type MfaEnrollResponse = z.infer<typeof MfaEnrollResponse>;

export const MfaVerifyRequest = z.object({
  factorId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});
export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequest>;

export const MfaChallengeRequest = z.object({
  code: z.string().regex(/^\d{6}$/),
});
export type MfaChallengeRequest = z.infer<typeof MfaChallengeRequest>;

export const MfaUnenrollRequest = z.object({
  factorId: z.string().uuid(),
});
export type MfaUnenrollRequest = z.infer<typeof MfaUnenrollRequest>;

// Password reset
export const PasswordResetRequest = z.object({
  email: Email,
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequest>;

export const PasswordResetConfirmRequest = z.object({
  token: z.string().min(1),
  newPassword: Password,
});
export type PasswordResetConfirmRequest = z.infer<typeof PasswordResetConfirmRequest>;

export const PasswordChangeRequest = z.object({
  currentPassword: z.string().min(1),
  newPassword: Password,
});
export type PasswordChangeRequest = z.infer<typeof PasswordChangeRequest>;

// Profile change OTP (email/phone)
export const ProfileChangeOtpRequest = z.object({
  action: z.enum(["request", "verify"]),
  changeType: z.enum(["email", "phone"]),
  newValue: z.string().min(1),
  code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
export type ProfileChangeOtpRequest = z.infer<typeof ProfileChangeOtpRequest>;
