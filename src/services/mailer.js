import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { unsubscribeUrl } from '../utils/unsubscribeToken.js';

export const smtpConfigured = () => Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.MAIL_FROM_EMAIL);

let transporter = null;
function getTransporter() {
  if (!smtpConfigured()) throw new Error('SMTP is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM_EMAIL)');
  return (transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  }));
}

export function withFooter(body, signature, to) {
  const parts = [body.trim()];
  if (signature?.trim()) parts.push(signature.trim());
  parts.push(`—\nIf you'd prefer not to hear from us again, unsubscribe here: ${unsubscribeUrl(to)}`);
  return parts.join('\n\n');
}

/**
 * @param {{ to: string | string[], subject: string, text: string, unsubscribeFor?: string }} mail
 *   `unsubscribeFor` — address the List-Unsubscribe link belongs to (defaults to `to`)
 */
export async function sendMail(mail) {
  const recipients = [mail.to].flat().join(', ');
  if (env.EMAIL_DRY_RUN) {
    console.log(`📭 [DRY RUN] would send to ${recipients}: "${mail.subject}"`);
    return { messageId: `dry-run-${Date.now()}`, dryRun: true };
  }

  const unsub = unsubscribeUrl(mail.unsubscribeFor ?? [mail.to].flat()[0]);
  const info = await getTransporter().sendMail({
    from: { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM_EMAIL },
    to: mail.to,
    replyTo: env.MAIL_REPLY_TO || undefined,
    subject: mail.subject,
    text: mail.text,
    headers: {
      'List-Unsubscribe': `<${unsub}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
  return { messageId: info.messageId, dryRun: false };
}
