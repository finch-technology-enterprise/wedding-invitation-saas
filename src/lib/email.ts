/**
 * Transactional email.
 *
 * Authentication logic never talks to a vendor. It calls
 * `sendTransactionalEmail`, which picks whichever provider the deployment
 * configured — or reports that none is available, which self-hosted mode
 * treats as a normal state rather than an error.
 *
 * ## Providers
 *
 * **Cloudflare Email Service** (`send_email` binding) when bound. Native
 * to the platform, no dependency, no API key. Requires a domain onboarded
 * to Email Sending and a paid Workers plan.
 *
 * **Resend** via its REST API when `RESEND_API_KEY` is set. A plain
 * `fetch` to one documented endpoint — the official SDK was evaluated and
 * rejected: it pulls a Node-shaped dependency tree to build a JSON body
 * we can write in four lines, for exactly two email types.
 *
 * Adding a third provider means adding a case here and nothing else.
 */

import { deploymentMode } from "./mode.js";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type EmailResult =
  | { ok: true; provider: string; messageId?: string }
  | { ok: false; provider: string; error: string };

/** Which provider this deployment will use, if any. */
export function emailProvider(env: Env): "cloudflare" | "resend" | "none" {
  if (env.EMAIL) return "cloudflare";
  if (env.RESEND_API_KEY) return "resend";
  return "none";
}

/**
 * Whether email-dependent flows can run at all.
 *
 * Hosted mode without a provider is a misconfiguration the operator needs
 * to see; self-hosted mode without one is an ordinary, supported choice.
 */
export function emailConfigured(env: Env): boolean {
  return emailProvider(env) !== "none";
}

function senderAddress(env: Env): string {
  return env.EMAIL_FROM || "noreply@example.com";
}

/**
 * Canonical base URL for links in emails.
 *
 * Never derived from the request's Host header: an attacker who can set
 * Host would otherwise receive password-reset links pointing at their own
 * domain. Configuration only.
 */
export function baseUrl(env: Env): string | null {
  const raw = env.PUBLIC_BASE_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function sendViaCloudflare(env: Env, message: EmailMessage): Promise<EmailResult> {
  try {
    const response = await (env.EMAIL as { send: (m: unknown) => Promise<{ messageId?: string }> }).send({
      from: senderAddress(env),
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    return { ok: true, provider: "cloudflare", messageId: response?.messageId };
  } catch (err) {
    return { ok: false, provider: "cloudflare", error: errorLabel(err) };
  }
}

async function sendViaResend(env: Env, message: EmailMessage): Promise<EmailResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: senderAddress(env),
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    if (!res.ok) {
      // Status only — a provider error body can echo the recipient.
      return { ok: false, provider: "resend", error: `http_${res.status}` };
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, provider: "resend", messageId: body.id };
  } catch (err) {
    return { ok: false, provider: "resend", error: errorLabel(err) };
  }
}

/** Error *class*, never the message: provider errors quote addresses. */
function errorLabel(err: unknown): string {
  return err instanceof Error ? err.name : "unknown_error";
}

/**
 * Send one transactional email.
 *
 * Never throws. Callers decide what a delivery failure means for their
 * flow — password reset, for instance, must stay enumeration-safe whether
 * or not the message went out.
 */
export async function sendTransactionalEmail(
  env: Env,
  message: EmailMessage
): Promise<EmailResult> {
  const provider = emailProvider(env);

  let result: EmailResult;
  switch (provider) {
    case "cloudflare":
      result = await sendViaCloudflare(env, message);
      break;
    case "resend":
      result = await sendViaResend(env, message);
      break;
    default:
      result = { ok: false, provider: "none", error: "not_configured" };
  }

  // Operation, outcome and provider only. No recipient, no subject, no
  // body, no token, and therefore no reset URL.
  if (!result.ok && result.error !== "not_configured") {
    console.error("email_send_failed", result.provider, result.error);
  }

  return result;
}

// ------------------------------------------------------------- templates

/** Escape interpolated values; templates carry no user-controlled HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(title: string, body: string, action: { url: string; label: string }): string {
  const safeUrl = escapeHtml(action.url);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f6f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:600">${escapeHtml(title)}</h1>
    ${body}
    <p style="margin:28px 0">
      <a href="${safeUrl}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:500">${escapeHtml(action.label)}</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#666">Or paste this link into your browser:</p>
    <p style="margin:0;font-size:13px;color:#666;word-break:break-all">${safeUrl}</p>
  </div>
</body></html>`;
}

export function passwordResetEmail(url: string, siteName: string, expiryMinutes: number): EmailMessage {
  const text = [
    `Reset your ${siteName} password`,
    "",
    "Open this link to choose a new password:",
    url,
    "",
    `The link expires in ${expiryMinutes} minutes and can be used once.`,
    "",
    "If you did not ask to reset your password, you can ignore this email —",
    "your password will not change. Someone may have typed your address by mistake.",
  ].join("\n");

  return {
    to: "",
    subject: `Reset your ${siteName} password`,
    text,
    html: layout(
      "Reset your password",
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">Choose a new password for your ${escapeHtml(siteName)} account.</p>
       <p style="margin:0;font-size:14px;color:#666">This link expires in ${expiryMinutes} minutes and can be used once.</p>
       <p style="margin:16px 0 0;font-size:14px;color:#666">If you did not ask for this, ignore this email — your password will not change.</p>`,
      { url, label: "Reset password" }
    ),
  };
}

export function verificationEmail(url: string, siteName: string, expiryHours: number): EmailMessage {
  const text = [
    `Confirm your email for ${siteName}`,
    "",
    "Open this link to confirm your address:",
    url,
    "",
    `The link expires in ${expiryHours} hours.`,
    "",
    "If you did not create an account, you can ignore this email.",
  ].join("\n");

  return {
    to: "",
    subject: `Confirm your email for ${siteName}`,
    text,
    html: layout(
      "Confirm your email",
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">Confirm this address to finish setting up your ${escapeHtml(siteName)} account.</p>
       <p style="margin:0;font-size:14px;color:#666">This link expires in ${expiryHours} hours.</p>
       <p style="margin:16px 0 0;font-size:14px;color:#666">If you did not create an account, ignore this email.</p>`,
      { url, label: "Confirm email" }
    ),
  };
}

/**
 * Whether hosted email verification is required.
 *
 * Self-hosted defaults to off so an instance without a mail provider is
 * fully usable. Hosted defaults to on, and an operator must opt out
 * explicitly rather than losing it silently to missing credentials.
 */
export function verificationRequired(env: Env): boolean {
  if (env.EMAIL_VERIFICATION_REQUIRED === "false") return false;
  if (env.EMAIL_VERIFICATION_REQUIRED === "true") return true;
  return deploymentMode(env) === "hosted";
}
