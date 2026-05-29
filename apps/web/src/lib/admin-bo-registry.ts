/**
 * Admin BO — single source of truth (sidebar, permissions module list, sensitive-data centre).
 *
 * Add a new sidebar entry: push into ADMIN_NAV_GROUPS_ALL with a matching moduleKey.
 * Add a new sensitive field: extend ADMIN_MODULES[moduleKey].sensitiveItems.
 * See docs/ADMIN_BO_REGISTRY.md for the full checklist.
 *
 * Q3 — Permission vocab vs BE enforcement.
 * The `sensitiveItems` below describe what the admin UI lets a user toggle in
 * the BO permission matrix. Several entries (`members:view_login_ips`,
 * `members:update`, `members:manual_adjust`, `members.kyc:approve`,
 * `transactions:view` / `transactions:export` / `transactions:manual_adjust`,
 * `merchants:network_config` / `:integration_urls` / `:cash_collection_fee`,
 * `permissions:update`, `templates:edit`, `loyalty:update` / `:manual_grant`,
 * `referrals:edit_config`, `affiliates:contact`, `commissions:export`) are
 * NOT enforced by any `requirePerm(...)` call in `apps/api/src` yet — they
 * exist as forward-looking descriptors. The BE today uses the broader
 * companion key (e.g. `transactions:view_full`, `members:freeze`, etc.).
 *
 * When wiring server-side enforcement for one of these items:
 *   1. Add the `requirePerm("resource", "action")` middleware to the route.
 *   2. Add the matching `["admin", "resource", "action"]` row to
 *      `apps/api/src/db/seed.ts::BO_PERMISSIONS` (otherwise the gate fails
 *      closed and the feature breaks for every admin).
 *   3. Re-run `npm --workspace apps/api run seed` on existing deployments.
 *
 * The seed comment block in `seed.ts` mirrors this list. Keep both in sync.
 */
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  Receipt,
  Store,
  Award,
  Gift,
  Percent,
  MessageSquare,
  ScrollText,
  Settings,
  UserCog,
  Shield,
  FileText,
  Layers,
  Scale,
  PlugZap,
} from "lucide-react";
import { AFFILIATE_MODULE_KEY, isAffiliateEnabled, isAffiliateModuleKey } from "@/lib/feature-flags";

export type StaffRole = "admin" | "accounting" | "support";

export type SensitivePermItem = {
  resource: string;
  action: string;
  label: string;
  description?: string;
};

/** Modül erişimi toggle'ının yazdığı izin (user override). */
export type ModuleViewPerm = {
  resource: string;
  action: string;
};

export type AdminModuleDef = {
  key: string;
  label: string;
  icon: LucideIcon;
  description?: string;
  /** Yetkiler → Modül erişimi satırı */
  moduleView: ModuleViewPerm;
  /** Hassas veri merkezi accordion başlığı (varsayılan: label) */
  sensitiveGroupLabel?: string;
  sensitiveItems?: SensitivePermItem[];
};

/**
 * Tüm BO modülleri — Yetkiler sayfasında listelenir (nav'daki sırayla birleştirilir).
 * Yeni modül: buraya ekle + nav item'da moduleKey kullan + migration'da bo_permissions seed.
 */
export const ADMIN_MODULES: Record<string, AdminModuleDef> = {
  dashboard: {
    key: "dashboard",
    label: "Panel",
    icon: LayoutDashboard,
    description: "Genel sistem özeti",
    moduleView: { resource: "dashboard", action: "view" },
  },
  members: {
    key: "members",
    label: "Üyeler",
    icon: Users,
    description: "Cüzdan üyeleri",
    moduleView: { resource: "members", action: "view_full" },
    sensitiveGroupLabel: "Üyeler",
    sensitiveItems: [
      { resource: "members.pii", action: "view_full", label: "Tam PII görüntüle", description: "Ad, telefon, e-posta maskesiz" },
      { resource: "members.pii", action: "view_masked", label: "Maskeli PII görüntüle" },
      { resource: "members.balance", action: "view_full", label: "Tam bakiye görüntüle" },
      { resource: "members.balance", action: "view_masked", label: "Maskeli bakiye görüntüle" },
      { resource: "members", action: "view_login_ips", label: "Giriş IP'lerini görüntüle", description: "IP, ülke, cihaz" },
      { resource: "members", action: "freeze", label: "Hesap dondur" },
      { resource: "members", action: "update", label: "Üye bilgilerini düzenle" },
      { resource: "members", action: "manual_adjust", label: "Bakiye / puan düzeltme" },
      { resource: "members.kyc", action: "approve", label: "KYC onayla / reddet" },
    ],
  },
  transactions: {
    key: "transactions",
    label: "İşlemler",
    icon: Receipt,
    moduleView: { resource: "transactions", action: "view_full" },
    sensitiveGroupLabel: "İşlemler",
    sensitiveItems: [
      { resource: "transactions", action: "view", label: "İşlem listesi görüntüle" },
      { resource: "transactions", action: "view_full", label: "Tam metadata görüntüle", description: "merchant_ref, external_tx_id" },
      { resource: "transactions", action: "export", label: "CSV/PDF dışa aktar" },
      { resource: "transactions", action: "manual_adjust", label: "Manuel düzeltme" },
      { resource: "withdrawals", action: "view_destination", label: "Çekim hedefi tam görüntüle", description: "Üye çekim IBAN ve hesap sahibi" },
    ],
  },
  chat: {
    key: "chat",
    label: "Destek",
    icon: MessageSquare,
    moduleView: { resource: "chat", action: "view" },
    sensitiveGroupLabel: "Destek (Chat)",
    sensitiveItems: [
      { resource: "chat", action: "view", label: "Destek talepleri" },
      { resource: "chat", action: "reply", label: "Talep cevapla / üstlen" },
      { resource: "chat", action: "approve_pcr", label: "Profil değişikliği onayla/reddet" },
    ],
  },
  merchants: {
    key: "merchants",
    label: "Merchant'lar",
    icon: Store,
    description: "Ticari + Finans merchant listeleri ve detay",
    moduleView: { resource: "merchants", action: "view_full" },
    sensitiveGroupLabel: "Merchant'lar",
    sensitiveItems: [
      { resource: "merchants", action: "view", label: "Merchant listesi" },
      { resource: "merchants", action: "view_full", label: "Tam merchant finansal görünüm" },
      { resource: "merchants", action: "update", label: "Komisyon + limitleri düzenle" },
      { resource: "merchants", action: "api_credentials", label: "API Key tam görüntüle" },
      { resource: "merchants", action: "network_config", label: "Ağ ayarları tam görüntüle", description: "IP whitelist, webhook URL" },
      { resource: "merchants", action: "integration_urls", label: "Entegrasyon URL tam görüntüle", description: "Topup init, kasa sync URL" },
      { resource: "merchants", action: "cash_collection_fee", label: "Finans tahsilat masrafı düzenle" },
      { resource: "merchants", action: "rotate_secret", label: "Secret yenile", description: "Rotate aksiyonu" },
    ],
  },
  merchant_children: {
    key: "merchant_children",
    label: "Bayiler",
    icon: Store,
    description: "Commerce child / bayi listesi",
    moduleView: { resource: "merchant_children", action: "view" },
    sensitiveGroupLabel: "Bayiler",
    sensitiveItems: [
      { resource: "merchant_children", action: "view", label: "Bayi listesi görüntüle" },
      { resource: "merchants", action: "api_credentials", label: "Bayi API Key tam görüntüle", description: "Bayi tablosu API key kolonu" },
    ],
  },
  finance_integrations: {
    key: "finance_integrations",
    label: "Finance Entegrasyon",
    icon: PlugZap,
    description: "Akış C/D entegrasyon hazırlığı",
    moduleView: { resource: "finance_integrations", action: "view" },
    sensitiveGroupLabel: "Finance Entegrasyon",
    sensitiveItems: [
      { resource: "finance_integrations", action: "view", label: "Entegrasyon paneli görüntüle" },
      { resource: "merchants", action: "api_credentials", label: "Finance merchant API Key" },
      { resource: "merchants", action: "integration_urls", label: "Init / sync URL tam görüntüle" },
      { resource: "merchants", action: "network_config", label: "Webhook URL tam görüntüle" },
    ],
  },
  affiliates: {
    key: "affiliates",
    label: "İş Ortakları",
    icon: Gift,
    moduleView: { resource: "affiliates", action: "view" },
    sensitiveGroupLabel: "Affiliate'ler",
    sensitiveItems: [
      { resource: "affiliates", action: "view", label: "Affiliate listesi" },
      { resource: "affiliates", action: "manage", label: "Affiliate yönetimi" },
      { resource: "affiliates", action: "contact", label: "İletişim + ödeme bilgisi", description: "E-posta, telefon, IBAN" },
    ],
  },
  commissions: {
    key: "commissions",
    label: "Komisyonlar",
    icon: Percent,
    moduleView: { resource: "commissions", action: "view" },
    sensitiveGroupLabel: "Komisyonlar",
    sensitiveItems: [
      { resource: "commissions", action: "view", label: "Komisyon raporları" },
      { resource: "commissions", action: "export", label: "Rapor dışa aktar" },
    ],
  },
  profit_share: {
    key: "profit_share",
    label: "Kazanç Dağıtımı",
    icon: Gift,
    moduleView: { resource: "profit_share", action: "view" },
    sensitiveGroupLabel: "Kazanç Dağıtımı",
    sensitiveItems: [
      { resource: "profit_share", action: "view", label: "Kampanya ve dağıtım görüntüle" },
      { resource: "profit_share", action: "manage", label: "Kampanya oluştur / yayınla" },
    ],
  },
  reconciliation: {
    key: "reconciliation",
    label: "Mutabakat",
    icon: Scale,
    moduleView: { resource: "reconciliation", action: "view" },
    sensitiveGroupLabel: "Mutabakat",
    sensitiveItems: [
      { resource: "reconciliation", action: "view", label: "Mutabakat ekranı görüntüle" },
      { resource: "ledger_integrity", action: "run", label: "Çapraz kontrol çalıştır (manuel)" },
    ],
  },
  loyalty: {
    key: "loyalty",
    label: "Sadakat",
    icon: Award,
    moduleView: { resource: "loyalty", action: "view" },
    sensitiveGroupLabel: "Sadakat",
    sensitiveItems: [
      { resource: "loyalty", action: "view", label: "Tier ve kural listesi" },
      { resource: "loyalty", action: "update", label: "Tier ve formül düzenle" },
      { resource: "loyalty", action: "manual_grant", label: "Manuel puan ver/düş" },
    ],
  },
  referrals: {
    key: "referrals",
    label: "Davetler",
    icon: Gift,
    moduleView: { resource: "referrals", action: "view" },
    sensitiveGroupLabel: "Davetler",
    sensitiveItems: [
      { resource: "referrals", action: "view", label: "Davet listesi" },
      { resource: "referrals", action: "manage", label: "Manuel onay/iptal" },
      { resource: "referrals", action: "edit_config", label: "Davet konfigürasyonu düzenle" },
    ],
  },
  system_logs: {
    key: "system_logs",
    label: "Sistem logları",
    icon: ScrollText,
    moduleView: { resource: "system_logs", action: "view" },
    sensitiveGroupLabel: "Sistem logları",
    sensitiveItems: [
      { resource: "audit_log", action: "view", label: "Audit log görüntüle" },
      { resource: "audit_log", action: "view_payload", label: "Log JSON detayı tam görüntüle" },
      { resource: "system_logs", action: "view", label: "System log görüntüle" },
    ],
  },
  settings: {
    key: "settings",
    label: "Ayarlar",
    icon: Settings,
    moduleView: { resource: "settings", action: "view" },
    sensitiveGroupLabel: "Ayarlar",
    sensitiveItems: [
      { resource: "settings", action: "view", label: "Ayarları görüntüle" },
      { resource: "settings", action: "update", label: "Ayarları düzenle" },
    ],
  },
  bo_users: {
    key: "bo_users",
    label: "BO Kullanıcıları",
    icon: UserCog,
    moduleView: { resource: "bo_users", action: "view" },
    sensitiveGroupLabel: "BO Kullanıcıları",
    sensitiveItems: [
      { resource: "bo_users", action: "view", label: "BO kullanıcı listesi" },
      { resource: "bo_users", action: "manage_roles", label: "Rol ekle/kaldır" },
    ],
  },
  permissions: {
    key: "permissions",
    label: "Yetkiler",
    icon: Shield,
    moduleView: { resource: "permissions", action: "view" },
    sensitiveGroupLabel: "Yetkiler",
    sensitiveItems: [
      { resource: "permissions", action: "view", label: "Yetkiler sayfası" },
      { resource: "permissions", action: "update", label: "Rol matrisi / override düzenle" },
    ],
  },
  templates: {
    key: "templates",
    label: "Şablonlar",
    icon: FileText,
    moduleView: { resource: "templates", action: "view" },
    sensitiveGroupLabel: "Şablonlar",
    sensitiveItems: [
      { resource: "templates", action: "view", label: "Şablonları görüntüle" },
      { resource: "templates", action: "edit", label: "Şablonları düzenle" },
    ],
  },
  method_types: {
    key: "method_types",
    label: "Yöntem Tipleri",
    icon: Layers,
    moduleView: { resource: "method_types", action: "view" },
    sensitiveGroupLabel: "Yöntem Tipleri",
    sensitiveItems: [
      { resource: "method_types", action: "view", label: "Katalog görüntüle" },
      { resource: "method_types", action: "edit", label: "Tip ekle / aç-kapa" },
    ],
  },
};

export type AdminNavItemDef = {
  /** i18n key veya sabit TR başlık */
  title: string;
  titleI18nKey?: string;
  url: string;
  icon: LucideIcon;
  roles: StaffRole[];
  moduleKey: string;
};

export type AdminNavGroupDef = {
  label: string;
  items: AdminNavItemDef[];
};

/** Sol menü yapısı — AdminLayout buradan üretilir. */
const ADMIN_NAV_GROUPS_ALL: AdminNavGroupDef[] = [
  {
    label: "Genel",
    items: [
      { title: "Panel", titleI18nKey: "admin.nav.dashboard", url: "/admin", icon: LayoutDashboard, roles: ["admin", "accounting", "support"], moduleKey: "dashboard" },
      { title: "Üyeler", titleI18nKey: "admin.nav.members", url: "/admin/members", icon: Users, roles: ["admin", "accounting", "support"], moduleKey: "members" },
      { title: "İşlemler", titleI18nKey: "admin.nav.transactions", url: "/admin/transactions", icon: Receipt, roles: ["admin", "accounting", "support"], moduleKey: "transactions" },
      { title: "Destek", url: "/admin/chat", icon: MessageSquare, roles: ["admin", "accounting", "support"], moduleKey: "chat" },
    ],
  },
  {
    label: "Merchant Yönetimi",
    items: [
      { title: "Ticari Merchant'lar", url: "/admin/merchants?type=commerce", icon: Store, roles: ["admin"], moduleKey: "merchants" },
      { title: "Bayiler", url: "/admin/merchant-children", icon: Store, roles: ["admin", "accounting"], moduleKey: "merchant_children" },
      { title: "Finans Merchant'lar", url: "/admin/merchants?type=finance", icon: Store, roles: ["admin"], moduleKey: "merchants" },
      { title: "Finance Entegrasyon", url: "/admin/finance-integrations", icon: PlugZap, roles: ["admin", "accounting"], moduleKey: "finance_integrations" },
      { title: "İş Ortakları", url: "/admin/affiliates", icon: Gift, roles: ["admin", "accounting"], moduleKey: "affiliates" },
    ],
  },
  {
    label: "Finans",
    items: [
      { title: "Komisyonlar", titleI18nKey: "admin.nav.commissions", url: "/admin/commissions", icon: Percent, roles: ["admin", "accounting"], moduleKey: "commissions" },
      { title: "Kazanç Dağıtımı", url: "/admin/profit-share", icon: Gift, roles: ["admin"], moduleKey: "profit_share" },
      { title: "Mutabakat", url: "/admin/reconciliation", icon: Scale, roles: ["admin", "accounting"], moduleKey: "reconciliation" },
    ],
  },
  {
    label: "Büyüme",
    items: [
      { title: "Sadakat", titleI18nKey: "admin.nav.loyalty", url: "/admin/loyalty", icon: Award, roles: ["admin"], moduleKey: "loyalty" },
      { title: "Davetler", url: "/admin/referrals", icon: Gift, roles: ["admin", "accounting", "support"], moduleKey: "referrals" },
    ],
  },
  {
    label: "Sistem",
    items: [
      { title: "Sistem logları", titleI18nKey: "admin.nav.systemLogs", url: "/admin/system-logs", icon: ScrollText, roles: ["admin", "accounting", "support"], moduleKey: "system_logs" },
      { title: "Ayarlar", titleI18nKey: "admin.nav.settings", url: "/admin/settings", icon: Settings, roles: ["admin"], moduleKey: "settings" },
      { title: "BO Kullanıcıları", titleI18nKey: "admin.nav.users", url: "/admin/users", icon: UserCog, roles: ["admin"], moduleKey: "bo_users" },
      { title: "Yetkiler", url: "/admin/permissions", icon: Shield, roles: ["admin"], moduleKey: "permissions" },
      { title: "Şablonlar", url: "/admin/templates", icon: FileText, roles: ["admin"], moduleKey: "templates" },
      { title: "Yöntem Tipleri", url: "/admin/method-types", icon: Layers, roles: ["admin"], moduleKey: "method_types" },
    ],
  },
];

/** Affiliate kapalıyken nav/izin listesinden çıkarılır. */
export function getAdminNavGroups(): AdminNavGroupDef[] {
  if (isAffiliateEnabled()) return ADMIN_NAV_GROUPS_ALL;
  return ADMIN_NAV_GROUPS_ALL.map((g) => ({
    ...g,
    items: g.items.filter((item) => !isAffiliateModuleKey(item.moduleKey)),
  })).filter((g) => g.items.length > 0);
}

/** @deprecated Doğrudan kullanmayın — getAdminNavGroups() tercih edin. */
export const ADMIN_NAV_GROUPS = ADMIN_NAV_GROUPS_ALL;

/** Yetkiler → Modül erişimi (nav sırası, tekrarlayan moduleKey bir kez). */
export function getPermissionModules(): AdminModuleDef[] {
  const seen = new Set<string>();
  const out: AdminModuleDef[] = [];
  for (const group of getAdminNavGroups()) {
    for (const item of group.items) {
      if (seen.has(item.moduleKey)) continue;
      seen.add(item.moduleKey);
      const mod = ADMIN_MODULES[item.moduleKey];
      if (!mod) continue;
      out.push(mod);
    }
  }
  return out;
}

/** Yetkiler → Hassas veri merkezi accordion. */
export function getSensitiveByPage(): Record<string, SensitivePermItem[]> {
  const out: Record<string, SensitivePermItem[]> = {};
  for (const mod of getPermissionModules()) {
    if (!mod.sensitiveItems?.length) continue;
    const page = mod.sensitiveGroupLabel ?? mod.label;
    out[page] = mod.sensitiveItems;
  }
  return out;
}

/** Nav item → modül view izni (override toggle). */
export function getModuleViewPerm(moduleKey: string): ModuleViewPerm {
  const mod = ADMIN_MODULES[moduleKey];
  if (!mod) return { resource: moduleKey, action: "view" };
  return mod.moduleView;
}

/** Tüm nav moduleKey'leri registry'de tanımlı mı — test için. */
export function validateAdminBoRegistry(): string[] {
  const errors: string[] = [];
  const navGroups = getAdminNavGroups();
  for (const group of navGroups) {
    for (const item of group.items) {
      if (!ADMIN_MODULES[item.moduleKey]) {
        errors.push(`Nav "${item.title}" moduleKey "${item.moduleKey}" ADMIN_MODULES içinde yok`);
      }
    }
  }
  const navKeys = new Set(navGroups.flatMap((g) => g.items.map((i) => i.moduleKey)));
  for (const key of Object.keys(ADMIN_MODULES)) {
    if (!isAffiliateEnabled() && key === AFFILIATE_MODULE_KEY) continue;
    if (!navKeys.has(key)) {
      errors.push(`ADMIN_MODULES "${key}" sol menüde kullanılmıyor (nav'a ekle veya modülü kaldır)`);
    }
  }
  return errors;
}
