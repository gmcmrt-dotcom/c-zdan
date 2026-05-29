// Topup session DTO'ları — Audit 3.3 fix
// =====================================
// İki RPC farklı kolon set'i döner:
//   • get_pending_topup() — açık session (status terminal değil)
//   • get_topup_session_status(_session_id) — herhangi bir session
//
// Frontend bu iki tipi karıştırırdı (Topup.tsx vs TopupStatus.tsx ayrı
// definitions). Burada tek kaynak: ortak base + her RPC'nin kendi shape'i.

export type TopupOpenStatus =
  | "pending"
  | "awaiting_member_action"
  | "member_confirmed"
  | "redirected";

export type TopupTerminalStatus =
  | "success"
  | "failed"
  | "expired"
  | "cancelled"
  | "timeout";

export type TopupSessionStatus = TopupOpenStatus | TopupTerminalStatus;

// Ortak alanlar (her iki RPC'de de var)
export interface TopupSessionBase {
  session_id: string;
  /** Insan-okur islem ID. Format: T-YYYYMMDD-NNNNNN */
  public_no: string | null;
  status: TopupSessionStatus;
  amount: number;
  method_type: string;
  iban: string | null;
  account_holder: string | null;
  bank_name: string | null;
  payment_reference: string | null;
  expires_at: string;
  member_confirmed_at: string | null;
}

// get_pending_topup() döner — açık session olduğu için status sadece
// open olabilir; created_at + member_confirmed_at içerir.
export interface PendingTopup extends TopupSessionBase {
  status: TopupOpenStatus;
  created_at: string;
  redirect_url?: string | null;
}

// get_topup_session_status(_session_id) döner — herhangi bir session;
// terminal'e ulaştığında redirect_url + finalized_at + topup_request_id
// dolu gelir.
export interface TopupSessionFull extends TopupSessionBase {
  redirect_url: string | null;
  finalized_at: string | null;
  topup_request_id: string | null;
}

export const PENDING_STATES: readonly TopupOpenStatus[] = [
  "pending",
  "awaiting_member_action",
  "member_confirmed",
  "redirected",
] as const;

export function isOpenStatus(s: TopupSessionStatus): s is TopupOpenStatus {
  return (PENDING_STATES as readonly TopupSessionStatus[]).includes(s);
}
