import { Unsubscribe } from '../models/Unsubscribe.js';
import { Lead } from '../models/Lead.js';
import { verifyUnsubscribeToken } from '../utils/unsubscribeToken.js';
import { publishEvent } from '../services/events.js';

/**
 * Public unsubscribe links. GET only shows a confirm button, because email security
 * scanners open links automatically; the actual opt-out happens on POST
 * (also used by Gmail/Outlook "one-click unsubscribe" via the List-Unsubscribe-Post header).
 */

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (res, status, title, body) =>
  res.status(status).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;
       background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#e2e8f0}
  .card{max-width:420px;margin:16px;padding:32px;border-radius:20px;background:rgba(255,255,255,.08);
        border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(16px);text-align:center}
  button{margin-top:16px;padding:12px 22px;border:0;border-radius:12px;background:#38bdf8;color:#0f172a;
         font-weight:600;font-size:15px;cursor:pointer}
</style></head><body><div class="card"><h2>${title}</h2>${body}</div></body></html>`);

const invalidLink = (res) => page(res, 400, 'Invalid link', '<p>This unsubscribe link is not valid.</p>');

// These pages are opened by email recipients, so errors are shown as a friendly HTML page
// rather than passed to the JSON error handler used by the API.
const serverError = (res) =>
  page(res, 500, 'Something went wrong', '<p>We could not process your request. Please try the link again later.</p>');

async function optOut(email) {
  await Unsubscribe.updateOne({ email }, { $setOnInsert: { email } }, { upsert: true });
  await Lead.updateMany({ 'emails.address': email }, { $set: { salesStatus: 'do_not_contact' } });
}

/** GET /u/:token — confirmation page (does not unsubscribe on its own). */
export function showUnsubscribe(req, res) {
  try {
    const email = verifyUnsubscribeToken(req.params.token);
    if (!email) return invalidLink(res);
    page(
      res,
      200,
      'Unsubscribe',
      `<p>Stop receiving emails at <b>${escapeHtml(email)}</b>?</p>
       <form method="post"><button type="submit">Unsubscribe</button></form>`,
    );
  } catch (err) {
    console.error('[unsubscribe] showUnsubscribe failed:', err);
    serverError(res);
  }
}

/** POST /u/:token — opt the address out and mark its leads do-not-contact. */
export async function confirmUnsubscribe(req, res) {
  try {
    const email = verifyUnsubscribeToken(req.params.token);
    if (!email) return invalidLink(res);
    await optOut(email);
    publishEvent('lead');
    page(res, 200, 'You are unsubscribed', `<p><b>${escapeHtml(email)}</b> will not receive further emails from us.</p>`);
  } catch (err) {
    console.error('[unsubscribe] confirmUnsubscribe failed:', err);
    serverError(res);
  }
}
