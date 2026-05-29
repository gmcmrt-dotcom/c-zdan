import { fmtDate, fmtTRY, kycStatusLabel, maskBalance } from "@/lib/format";
import { maskEmail, maskName, maskPhone } from "@/lib/mask";

export type AdminMemberRow = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  member_no: string;
  is_frozen: boolean;
  kyc_status: string;
  created_at: string;
  balance: number;
  reserved_balance: number;
  total_points: number;
  tier_name: string | null;
  last_login_at: string | null;
  open_chat_count: number;
  has_more?: boolean;
};

export type MemberListFilters = {
  search: string;
  frozenFilter: "all" | "active" | "frozen";
  kycFilter: "all" | "pending" | "verified" | "rejected";
  createdFrom?: string;
  createdTo?: string;
  reservedOnly: boolean;
  sortBy: "created_at" | "balance" | "points" | "last_login" | "name";
  sortDir: "asc" | "desc";
};

export function memberListRpcParams(filters: MemberListFilters, offset: number, limit: number) {
  return {
    _search: filters.search.trim() || null,
    _frozen_filter: filters.frozenFilter,
    _kyc_filter: filters.kycFilter,
    _created_from: filters.createdFrom || null,
    _created_to: filters.createdTo || null,
    _reserved_only: filters.reservedOnly,
    _sort_by: filters.sortBy,
    _sort_dir: filters.sortDir,
    _offset: offset,
    _limit: limit,
  };
}

type PiiFmt = {
  showFullPii: boolean;
  showFullBalance: boolean;
};

export function formatMemberName(row: AdminMemberRow, pii: PiiFmt): string {
  const full = `${row.first_name} ${row.last_name}`.trim();
  return pii.showFullPii ? full : maskName(full);
}

export function formatMemberEmail(row: AdminMemberRow, pii: PiiFmt): string {
  return pii.showFullPii ? row.email : maskEmail(row.email);
}

export function formatMemberPhone(row: AdminMemberRow, pii: PiiFmt): string {
  if (!row.phone) return "—";
  return pii.showFullPii ? row.phone : maskPhone(row.phone);
}

export function formatMemberBalance(amount: number, pii: PiiFmt): string {
  return maskBalance(amount, pii.showFullBalance);
}

export function exportMembersCsv(
  rows: AdminMemberRow[],
  pii: PiiFmt,
  filenamePrefix = "members",
) {
  const header = "Üyelik No;Ad Soyad;E-posta;Telefon;KYC;Durum;Bakiye;Rezerve;Puan;Seviye;Kayıt;Son Giriş;Açık Destek\n";
  const body = rows
    .map((m) => {
      const status = m.is_frozen ? "Donduruldu" : "Aktif";
      return [
        m.member_no,
        formatMemberName(m, pii),
        formatMemberEmail(m, pii),
        formatMemberPhone(m, pii),
        kycStatusLabel(m.kyc_status),
        status,
        formatMemberBalance(Number(m.balance), pii),
        formatMemberBalance(Number(m.reserved_balance), pii),
        m.total_points,
        m.tier_name ?? "",
        fmtDate(m.created_at),
        m.last_login_at ? fmtDate(m.last_login_at) : "",
        m.open_chat_count,
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(";");
    })
    .join("\n");
  const blob = new Blob(["\uFEFF" + header + body], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${filenamePrefix}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
