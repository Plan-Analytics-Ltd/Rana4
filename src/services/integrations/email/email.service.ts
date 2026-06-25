import nodemailer from "nodemailer";
import { getOptionalSecret } from "../../security/secrets/index.js";

type SendEmailArgs = {
  to: string;
  subject: string;
  text: string;
};

function getSmtpConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const portStr = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = getOptionalSecret("SMTP_PASS");
  const from = process.env.SMTP_FROM?.trim();

  if (!host || !portStr || !from) return null;
  const port = Number(portStr);
  if (!Number.isFinite(port) || port <= 0) return null;
  return { host, port, user, pass, from };
}

export async function sendEmail({ to, subject, text }: SendEmailArgs): Promise<{ ok: boolean; mode: "smtp" | "log" }> {
  const cfg = getSmtpConfig();
  if (!cfg) {
    console.info("[email:log] Email suppressed because SMTP is not configured", { to, subject });
    return { ok: true, mode: "log" };
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
  });

  await transporter.sendMail({
    from: cfg.from,
    to,
    subject,
    text,
  });

  return { ok: true, mode: "smtp" };
}

export async function sendVerificationCodeEmail(args: { to: string; code: string }): Promise<{ ok: boolean; mode: "smtp" | "log" }> {
  const appUrl = (process.env.APP_URL?.trim() || "").replace(/\/+$/, "");
  const link = appUrl ? `${appUrl}/verify-email` : null;
  const text = [
    "Your verification code:",
    "",
    args.code,
    "",
    "This code expires in 24 hours.",
    link ? `\nOpen: ${link}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return sendEmail({ to: args.to, subject: "Verify your email", text });
}

