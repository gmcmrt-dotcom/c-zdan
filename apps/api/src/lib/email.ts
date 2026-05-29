/**
 * N — Email transport (Q6 decision: SMTP).
 *
 * Two backends are supported:
 *   - SMTP (preferred, configured via SMTP_HOST/PORT/USER/PASS/SECURE)
 *   - Resend (legacy fallback, configured via RESEND_API_KEY)
 *
 * If neither is configured, `sendEmail` returns a structured
 * `EMAIL_NOT_CONFIGURED` skip — never throws, so the dispatcher can
 * keep draining the outbox and queue retries if email transport
 * becomes available later.
 *
 * The deploy-side env is intentionally NOT smoke-tested at startup;
 * any SMTP misconfiguration surfaces on the first event send via the
 * dispatcher's structured retry queue (so a permanent failure ends up
 * in `event_outbox.status='failed'` instead of looping forever).
 */
import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";
import { env } from "./env";
import { logger } from "./logger";

export type EmailResult = { ok: true; transport: "smtp" | "resend" } | { ok: false; error: string };

let smtpTransporter: Transporter | null = null;
function getSmtp(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (!smtpTransporter) {
    const port = env.SMTP_PORT ?? 587;
    smtpTransporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      // If `SMTP_SECURE` is unset, follow nodemailer's defaults:
      // secure=true for port 465 only; STARTTLS for everything else.
      secure: env.SMTP_SECURE ?? port === 465,
      auth:
        env.SMTP_USER && env.SMTP_PASS
          ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
          : undefined,
      // Cap per-message wall-clock so a stalled SMTP server doesn't
      // block the dispatcher tick forever.
      connectionTimeout: 8_000,
      socketTimeout: 15_000,
    });
  }
  return smtpTransporter;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<EmailResult> {
  if (!env.NOTIFICATION_FROM_EMAIL) {
    return { ok: false, error: "EMAIL_NOT_CONFIGURED" };
  }
  // SMTP first (Q6 chose SMTP).
  const smtp = getSmtp();
  if (smtp) {
    try {
      await smtp.sendMail({
        from: env.NOTIFICATION_FROM_EMAIL,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });
      return { ok: true, transport: "smtp" };
    } catch (err) {
      logger.warn({ err, to: opts.to.split("@")[1] }, "smtp send failed");
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  // Resend fallback (kept for back-compat with the original dispatcher).
  if (env.RESEND_API_KEY) {
    try {
      const client = new Resend(env.RESEND_API_KEY);
      const r = await client.emails.send({
        from: env.NOTIFICATION_FROM_EMAIL,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });
      if (r.error) return { ok: false, error: r.error.message };
      return { ok: true, transport: "resend" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: false, error: "EMAIL_NOT_CONFIGURED" };
}

// ---------- Template helpers ----------
//
// All templates are server-rendered HTML strings (no templating engine).
// PII (email, name) is rendered verbatim — the caller is responsible for
// passing the right values; no user-controlled HTML is interpolated.
// Designs are intentionally minimal so they render in every email client.

const PRODUCT_NAME = "Wallet";

function wrap(body: string, footer = `${PRODUCT_NAME} — bu mesaj otomatik gönderildi.`): string {
  return `<!doctype html>
<html><body style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:24px auto;padding:0 16px;color:#222;line-height:1.5">
${body}
<hr style="border:0;border-top:1px solid #eee;margin:24px 0">
<p style="color:#888;font-size:12px">${footer}</p>
</body></html>`;
}

export interface PasswordResetEmailVars {
  name?: string | null;
  resetLink: string;
}
export function passwordResetTemplate(vars: PasswordResetEmailVars) {
  const greeting = vars.name ? `Merhaba ${vars.name},` : "Merhaba,";
  return {
    subject: `${PRODUCT_NAME} — şifre sıfırlama isteği`,
    html: wrap(`
      <p>${greeting}</p>
      <p>${PRODUCT_NAME} hesabın için şifre sıfırlama isteği aldık. Aşağıdaki bağlantıya tıklayarak yeni bir şifre belirleyebilirsin.</p>
      <p><a href="${vars.resetLink}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:8px">Şifremi sıfırla</a></p>
      <p style="color:#666;font-size:13px">Bu bağlantı 30 dakika içinde geçersiz olacaktır. Sen istemediysen bu e-postayı yok say; hesabın güvende.</p>
    `),
  };
}

export interface ProfileChangeOtpEmailVars {
  name?: string | null;
  otp: string;
  field: "email" | "phone";
  /** OPTIONAL: the OLD address we're notifying. If passed, we say so in the body. */
  notifyOldAddress?: boolean;
}
export function profileChangeOtpTemplate(vars: ProfileChangeOtpEmailVars) {
  const greeting = vars.name ? `Merhaba ${vars.name},` : "Merhaba,";
  const fieldLabel = vars.field === "email" ? "e-posta" : "telefon";
  const prelude = vars.notifyOldAddress
    ? `Hesabının ${fieldLabel} adresinin değiştirilmesi talep edildi. Bu işlem senin onayın olmadan başlatılmadıysa lütfen acilen destek ile iletişime geç.`
    : `${fieldLabel} adresi değişikliği için doğrulama kodu:`;
  return {
    subject: `${PRODUCT_NAME} — ${fieldLabel} değişikliği doğrulama`,
    html: wrap(`
      <p>${greeting}</p>
      <p>${prelude}</p>
      <p style="font-size:28px;font-weight:600;letter-spacing:4px;text-align:center;background:#f4f4f4;padding:14px;border-radius:8px">${vars.otp}</p>
      <p style="color:#666;font-size:13px">Bu kod 5 dakika geçerlidir. Sen istemediysen bu e-postayı yok say.</p>
    `),
  };
}

export interface MfaBackupCodesEmailVars {
  name?: string | null;
  codes: string[];
}
export function mfaBackupCodesTemplate(vars: MfaBackupCodesEmailVars) {
  const greeting = vars.name ? `Merhaba ${vars.name},` : "Merhaba,";
  const list = vars.codes
    .map((c) => `<li style="font-family:ui-monospace,Menlo,monospace;font-size:15px;margin:4px 0">${c}</li>`)
    .join("");
  return {
    subject: `${PRODUCT_NAME} — MFA yedek kurtarma kodları`,
    html: wrap(`
      <p>${greeting}</p>
      <p>Telefonun kayıp veya bozuk olursa kullanabileceğin tek seferlik kurtarma kodları:</p>
      <ol style="padding-left:18px">${list}</ol>
      <p style="color:#666;font-size:13px">Her kod sadece bir kez kullanılabilir. Bu listeyi güvenli bir yerde sakla (parola yöneticisi, basılı kopya).</p>
    `),
  };
}

export interface NewDeviceLoginEmailVars {
  name?: string | null;
  ip: string | null;
  userAgent: string | null;
  whenIso: string;
}
export function newDeviceLoginTemplate(vars: NewDeviceLoginEmailVars) {
  const greeting = vars.name ? `Merhaba ${vars.name},` : "Merhaba,";
  return {
    subject: `${PRODUCT_NAME} — yeni cihazdan giriş`,
    html: wrap(`
      <p>${greeting}</p>
      <p>Hesabına yeni bir cihazdan giriş yapıldı:</p>
      <ul>
        <li><b>Zaman:</b> ${vars.whenIso}</li>
        <li><b>IP:</b> ${vars.ip ?? "(bilinmiyor)"}</li>
        <li><b>Tarayıcı / cihaz:</b> ${vars.userAgent ?? "(bilinmiyor)"}</li>
      </ul>
      <p>Sen değilsen lütfen acilen şifreni değiştir ve tüm cihazlardan çıkış yap.</p>
    `),
  };
}

export interface ProfitSharePublishedEmailVars {
  name?: string | null;
  amount: string;
  expiresAt: string;
  claimUrl: string;
}
export function profitSharePublishedTemplate(vars: ProfitSharePublishedEmailVars) {
  const greeting = vars.name ? `Merhaba ${vars.name},` : "Merhaba,";
  return {
    subject: `${PRODUCT_NAME} — kazanç payın hazır`,
    html: wrap(`
      <p>${greeting}</p>
      <p>Kazanç dağıtımı kapsamında sana özel <b>${vars.amount}</b> kazanç payı tanımlandı.</p>
      <p>Son kullanım zamanı: <b>${vars.expiresAt}</b></p>
      <p><a href="${vars.claimUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:8px">Kazanç payını al</a></p>
      <p style="color:#666;font-size:13px">Süre içinde işlem yapılmazsa bu kazanç payı otomatik iptal edilir.</p>
    `),
    text: [
      greeting,
      "",
      `Kazanç payın hazır: ${vars.amount}`,
      `Son kullanım: ${vars.expiresAt}`,
      `Almak için: ${vars.claimUrl}`,
    ].join("\n"),
  };
}
