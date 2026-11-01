import nodemailer from "nodemailer";
import { env } from "./env.js";

export class EmailDeliveryError extends Error {
  constructor(message = "Email delivery is not configured") {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeLocalDevelopmentFallback(type: "password-reset" | "verification") {
  if (!['development', 'test'].includes(env.nodeEnv)) {
    throw new EmailDeliveryError(`Email delivery is not configured for ${type}.`);
  }

  const frontend = new URL(env.frontendOrigin);
  if (!["localhost", "127.0.0.1", "::1"].includes(frontend.hostname)) {
    throw new EmailDeliveryError(`Email delivery is not configured for ${type}.`);
  }

  console.info(`Local ${type} email delivery is available in ${env.nodeEnv} mode.`);
}

function buildHtmlEmail({
  title,
  intro,
  actionLabel,
  actionUrl,
  secondaryText,
  footer,
}: {
  title: string;
  intro: string;
  actionLabel: string;
  actionUrl: string;
  secondaryText: string;
  footer: string;
}) {
  const safeTitle = escapeHtml(title);
  const safeIntro = escapeHtml(intro);
  const safeActionLabel = escapeHtml(actionLabel);
  const safeSecondaryText = escapeHtml(secondaryText);
  const safeFooter = escapeHtml(footer);
  const safeActionUrl = escapeHtml(actionUrl);

  return `
    <div style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f7fb;padding:24px 0;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" max-width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #e7edf8;border-radius:12px;overflow:hidden;">
              <tr>
                <td style="padding:32px 32px 16px;background:#102a43;color:#ffffff;border-radius:12px 12px 0 0;">
                  <div style="font-size:24px;font-weight:700;letter-spacing:0.04em;">CampusConnect</div>
                </td>
              </tr>
              <tr>
                <td style="padding:32px 32px 12px;color:#1f2937;">
                  <h2 style="margin:0 0 16px;font-size:28px;line-height:1.3;color:#102a43;">${safeTitle}</h2>
                  <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">${safeIntro}</p>
                  <p style="margin:0 0 20px;">
                    <a href="${safeActionUrl}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:700;">${safeActionLabel}</a>
                  </p>
                  <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#4b5563;">${safeSecondaryText}</p>
                  <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;">${safeFooter}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
}

async function sendEmail({
  to,
  subject,
  text,
  html,
}: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  if (!env.smtp) {
    safeLocalDevelopmentFallback("password-reset");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    auth: {
      user: env.smtp.user,
      pass: env.smtp.password,
    },
  });

  try {
    await transporter.sendMail({
      from: env.smtp.from,
      to,
      subject,
      text,
      html,
    });
  } catch (error) {
    console.error("SMTP email delivery failed", {
      to: to.replace(/(.{2}).+(@.*)/, "$1***$2"),
      subject,
      message: error instanceof Error ? error.message : "Unknown SMTP error",
    });
    throw new EmailDeliveryError("Email delivery failed");
  }
}

export async function deliverPasswordResetLink(email: string, resetUrl: string) {
  if (!env.smtp) {
    safeLocalDevelopmentFallback("password-reset");
    return;
  }

  const html = buildHtmlEmail({
    title: "Reset your CampusConnect password",
    intro: "We received a request to reset your CampusConnect password.",
    actionLabel: "Reset Password",
    actionUrl: resetUrl,
    secondaryText: "This link expires according to the existing password reset policy. If you did not request this change, you can safely ignore this email.",
    footer: "Need help? Contact CampusConnect support from your campus portal.",
  });

  await sendEmail({
    to: email,
    subject: "Reset your CampusConnect password",
    text: `We received a request to reset your CampusConnect password. Use this link to continue:\n\n${resetUrl}\n\nIf you did not request this change, you can ignore this email.`,
    html,
  });
}

export async function deliverVerificationLink(email: string, name: string, verificationUrl: string) {
  if (!env.smtp) {
    safeLocalDevelopmentFallback("verification");
    return;
  }

  const html = buildHtmlEmail({
    title: "Verify your CampusConnect email address",
    intro: `Hello ${escapeHtml(name)},<br /><br />Welcome to CampusConnect! Please verify your email address to activate your account.`,
    actionLabel: "Verify Email Address",
    actionUrl: verificationUrl,
    secondaryText: "This link expires in 24 hours. If you did not create this account, you can safely ignore this message.",
    footer: "CampusConnect will keep your account private and secure.",
  });

  await sendEmail({
    to: email,
    subject: "Verify your CampusConnect email address",
    text: `Hello ${name},\n\nWelcome to CampusConnect! Please verify your email address to activate your account.\n\n${verificationUrl}\n\nThis link expires in 24 hours.`,
    html,
  });
}
