import crypto from 'crypto';
import { env } from '../config/env.js';

const sign = (email) =>
  crypto.createHmac('sha256', env.UNSUBSCRIBE_SECRET).update(email.toLowerCase()).digest('base64url').slice(0, 32);

export function unsubscribeToken(email) {
  return `${Buffer.from(email.toLowerCase()).toString('base64url')}.${sign(email)}`;
}

export function unsubscribeUrl(email) {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/u/${unsubscribeToken(email)}`;
}

/** Returns the email if the token is valid, otherwise null. */
export function verifyUnsubscribeToken(token) {
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const email = Buffer.from(encoded, 'base64url').toString('utf8');
  const expected = sign(email);
  if (sig.length !== expected.length) return null;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? email : null;
}
