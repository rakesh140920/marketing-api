import { z } from 'zod';
import { EmailMessage, EMAIL_STATUSES } from '../models/EmailMessage.js';
import { Lead } from '../models/Lead.js';
import { Unsubscribe } from '../models/Unsubscribe.js';
import { enqueueDraft, enqueueSend } from '../queues/index.js';
import { aiConfigured } from '../services/ai.js';
import { HttpError } from '../middleware/error.js';
import { publishEvent } from '../services/events.js';

const draftSchema = z.object({ leadIds: z.array(z.string()).min(1).max(200) });

const listSchema = z.object({ status: z.enum(EMAIL_STATUSES).optional() });

const editSchema = z.object({
  to: z.string().trim().toLowerCase().pipe(z.email()).optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(10_000).optional(),
});

async function findEmailOr404(id) {
  const email = await EmailMessage.findById(id);
  if (!email) throw new HttpError(404, 'Email not found');
  return email;
}

// Errors are passed to next() so the central error handler (middleware/error.js)
// turns validation errors into 400, HttpError into its status, and anything else into 500.

/** POST /api/emails/draft — ask the AI to draft emails for the given leads. Leads without any email are skipped. */
export async function draftEmails(req, res, next) {
  try {
    const { leadIds } = draftSchema.parse(req.body);
    if (!aiConfigured()) throw new HttpError(400, 'AI is not configured (ANTHROPIC_API_KEY)');

    const leads = await Lead.find({
      _id: { $in: leadIds },
      'emails.0': { $exists: true },
      salesStatus: { $ne: 'do_not_contact' },
    })
      .select('_id')
      .lean();
    await Promise.all(leads.map((l) => enqueueDraft(String(l._id))));
    res.json({ queued: leads.length, skipped: leadIds.length - leads.length });
  } catch (err) {
    console.error('[emails] draftEmails failed:', err);
    next(err);
  }
}

/** GET /api/emails?status= — latest emails, optionally filtered by status. */
export async function listEmails(req, res, next) {
  try {
    const { status } = listSchema.parse(req.query);
    const emails = await EmailMessage.find(status ? { status } : {})
      .sort({ updatedAt: -1 })
      .limit(200)
      .populate('leadId', 'name city website productId ai.fitScore ai.contactPersonName')
      .lean();
    res.json(emails);
  } catch (err) {
    console.error('[emails] listEmails failed:', err);
    next(err);
  }
}

/** PATCH /api/emails/:id — edit recipient, subject or body. Editing a failed/rejected email makes it a draft again. */
export async function updateEmail(req, res, next) {
  try {
    const body = editSchema.parse(req.body);
    const email = await findEmailOr404(req.params.id);
    if (!['draft', 'failed', 'rejected'].includes(email.status)) {
      throw new HttpError(409, `Cannot edit an email that is ${email.status}`);
    }
    Object.assign(email, body);
    if (email.status !== 'draft') {
      email.status = 'draft';
      email.error = undefined;
    }
    await email.save();
    publishEvent('email', { id: String(email._id), leadId: String(email.leadId) });
    res.json(email);
  } catch (err) {
    console.error('[emails] updateEmail failed:', err);
    next(err);
  }
}

/** POST /api/emails/:id/approve — human approval; queues the email for sending. */
export async function approveEmail(req, res, next) {
  try {
    const email = await findEmailOr404(req.params.id);
    if (email.status !== 'draft') throw new HttpError(409, `Only drafts can be approved (this one is ${email.status})`);
    if (!email.to) throw new HttpError(400, 'Recipient email is missing');
    if (await Unsubscribe.exists({ email: email.to })) throw new HttpError(409, 'This recipient has unsubscribed');

    email.status = 'approved';
    email.approvedAt = new Date();
    await email.save();
    await enqueueSend(String(email._id));
    publishEvent('email', { id: String(email._id), leadId: String(email.leadId) });
    res.json(email);
  } catch (err) {
    console.error('[emails] approveEmail failed:', err);
    next(err);
  }
}

/** POST /api/emails/:id/reject — discard a draft. */
export async function rejectEmail(req, res, next) {
  try {
    const email = await findEmailOr404(req.params.id);
    if (email.status !== 'draft') throw new HttpError(409, `Only drafts can be rejected (this one is ${email.status})`);
    email.status = 'rejected';
    await email.save();
    publishEvent('email', { id: String(email._id), leadId: String(email.leadId) });
    res.json(email);
  } catch (err) {
    console.error('[emails] rejectEmail failed:', err);
    next(err);
  }
}
