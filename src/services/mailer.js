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
    // Fail in seconds, not Nodemailer's default 2 minutes, when the server is unreachable
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  }));
}

/** Turn common SMTP errors (especially Gmail's) into a message that says what to fix. */
function explainSmtpError(err) {
  const gmail = /gmail\.com$/i.test(env.SMTP_HOST ?? '');
  if (err.code === 'EAUTH' || err.responseCode === 535) {
    return gmail
      ? 'Gmail rejected the login. SMTP_PASS must be a 16-character Google App Password (Google Account → Security → 2-Step Verification → App passwords), not your normal password, and SMTP_USER must be the full Gmail address.'
      : `SMTP login failed — check SMTP_USER / SMTP_PASS (${err.message})`;
  }
  if (err.code === 'ESOCKET' || err.code === 'ECONNECTION' || err.code === 'ETIMEDOUT') {
    return `Cannot reach ${env.SMTP_HOST}:${env.SMTP_PORT} — check SMTP_HOST / SMTP_PORT / SMTP_SECURE (Gmail: 465 + true, or 587 + false). ${err.message}`;
  }
  if (gmail && /daily user sending limit|limit exceeded/i.test(err.message)) {
    return `Gmail's daily sending limit was reached — try again tomorrow or lower EMAIL_DAILY_LIMIT. ${err.message}`;
  }
  return err.message;
}

/** Log on startup whether email sending will work, so a bad password shows up immediately. */
export async function verifySmtp() {
  if (env.EMAIL_DRY_RUN) {
    console.log('📭 EMAIL_DRY_RUN is on — approved emails are logged, not sent');
    return;
  }
  if (!smtpConfigured()) {
    const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM_EMAIL'].filter((k) => !env[k]);
    console.warn(`⚠️  Email sending is not configured — set ${missing.join(', ')} in backend/.env`);
    return;
  }
  try {
    await getTransporter().verify();
    console.log(`✅ SMTP ready — sending as ${env.MAIL_FROM_NAME} <${env.MAIL_FROM_EMAIL}> via ${env.SMTP_HOST}`);
  } catch (err) {
    console.error(`❌ SMTP check failed: ${explainSmtpError(err)}`);
  }
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
  // The send worker logs every email (with lead and mode), so nothing is logged here
  if (env.EMAIL_DRY_RUN) {
    return { messageId: `dry-run-${Date.now()}`, dryRun: true };
  }

  const unsub = unsubscribeUrl(mail.unsubscribeFor ?? [mail.to].flat()[0]);
  const info = await getTransporter()
    .sendMail({
      from: { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM_EMAIL },
      to: mail.to,
      replyTo: env.MAIL_REPLY_TO || undefined,
      subject: mail.subject,
      text: mail.text,
      headers: {
        'List-Unsubscribe': `<${unsub}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    })
    .catch((err) => {
      throw new Error(explainSmtpError(err));
    });
  return { messageId: info.messageId, dryRun: false };
}
