import { z } from 'zod';
import { Lead, PIPELINE_STATUSES, SALES_STATUSES } from '../models/Lead.js';
import { EmailMessage } from '../models/EmailMessage.js';
import { enqueueEnrich } from '../queues/index.js';
import { HttpError } from '../middleware/error.js';
import { publishEvent } from '../services/events.js';

const listSchema = z.object({
  q: z.string().trim().optional(),
  productId: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid product').optional(),
  searchId: z.string().optional(),
  pipelineStatus: z.enum(PIPELINE_STATUSES).optional(),
  salesStatus: z.enum(SALES_STATUSES).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  hasEmail: z.enum(['true', 'false']).optional(),
  sort: z.enum(['score', 'recent', 'name']).default('score'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const patchSchema = z.object({
  salesStatus: z.enum(SALES_STATUSES).optional(),
  notes: z.string().max(5000).optional(),
  website: z.string().trim().max(300).optional(),
  addEmail: z.string().trim().toLowerCase().pipe(z.email()).optional(),
  removeEmail: z.string().trim().toLowerCase().optional(),
});

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function findLeadOr404(id) {
  const lead = await Lead.findById(id);
  if (!lead) throw new HttpError(404, 'Lead not found');
  return lead;
}

// Errors are passed to next() so the central error handler (middleware/error.js)
// turns validation errors into 400, HttpError into its status, and anything else into 500.

/** GET /api/leads — filtered, sorted, paginated lead list. */
export async function listLeads(req, res, next) {
  try {
    const p = listSchema.parse(req.query);
    const filter = {};
    if (p.q) {
      const rx = new RegExp(escapeRegex(p.q), 'i');
      filter.$or = [{ name: rx }, { city: rx }, { address: rx }, { 'emails.address': rx }];
    }
    if (p.productId) filter.productId = p.productId;
    if (p.searchId) filter.searchId = p.searchId;
    if (p.pipelineStatus) filter.pipelineStatus = p.pipelineStatus;
    if (p.salesStatus) filter.salesStatus = p.salesStatus;
    if (p.minScore !== undefined) filter['ai.fitScore'] = { $gte: p.minScore };
    if (p.hasEmail === 'true') filter['emails.0'] = { $exists: true };
    if (p.hasEmail === 'false') filter['emails.0'] = { $exists: false };

    const sort =
      p.sort === 'score' ? { 'ai.fitScore': -1, createdAt: -1 } : p.sort === 'name' ? { name: 1 } : { createdAt: -1 };

    const [items, total] = await Promise.all([
      Lead.find(filter)
        .sort(sort)
        .skip((p.page - 1) * p.limit)
        .limit(p.limit)
        .lean(),
      Lead.countDocuments(filter),
    ]);
    res.json({ items, total, page: p.page, pages: Math.max(1, Math.ceil(total / p.limit)) });
  } catch (err) {
    console.error('[leads] listLeads failed:', err);
    next(err);
  }
}

/** GET /api/leads/:id — one lead plus its outreach emails. */
export async function getLead(req, res, next) {
  try {
    const lead = await Lead.findById(req.params.id).lean();
    if (!lead) throw new HttpError(404, 'Lead not found');
    const emails = await EmailMessage.find({ leadId: lead._id }).sort({ createdAt: -1 }).lean();
    res.json({ ...lead, outreach: emails });
  } catch (err) {
    console.error('[leads] getLead failed:', err);
    next(err);
  }
}

/** PATCH /api/leads/:id — sales status, notes, website, add/remove an email. */
export async function updateLead(req, res, next) {
  try {
    const body = patchSchema.parse(req.body);
    const lead = await findLeadOr404(req.params.id);

    if (body.salesStatus) lead.salesStatus = body.salesStatus;
    if (body.notes !== undefined) lead.notes = body.notes;
    if (body.website !== undefined) lead.website = body.website || undefined;
    if (body.addEmail && !lead.emails.some((e) => e.address === body.addEmail)) {
      lead.emails.push({ address: body.addEmail, source: 'manual' });
    }
    if (body.removeEmail) {
      lead.set(
        'emails',
        lead.emails.filter((e) => e.address !== body.removeEmail),
      );
    }
    await lead.save();
    publishEvent('lead', { id: String(lead._id) });
    res.json(lead);
  } catch (err) {
    console.error('[leads] updateLead failed:', err);
    next(err);
  }
}

/** POST /api/leads/:id/enrich — re-run website research for one lead. */
export async function enrichLead(req, res, next) {
  try {
    const lead = await findLeadOr404(req.params.id);
    if (!lead.website) throw new HttpError(400, 'Lead has no website to research');
    lead.pipelineStatus = 'new';
    lead.pipelineError = undefined;
    await lead.save();
    await enqueueEnrich(String(lead._id));
    publishEvent('lead', { id: String(lead._id) });
    res.json(lead);
  } catch (err) {
    console.error('[leads] enrichLead failed:', err);
    next(err);
  }
}

/** POST /api/leads/enrich-pending — re-queue research for every lead stuck in "new" or "failed". */
export async function enrichPendingLeads(_req, res, next) {
  try {
    const leads = await Lead.find({ pipelineStatus: { $in: ['new', 'failed'] }, website: { $nin: [null, ''] } })
      .select('_id')
      .lean();
    await Promise.all(leads.map((l) => enqueueEnrich(String(l._id))));
    if (leads.length) publishEvent('lead');
    res.json({ queued: leads.length });
  } catch (err) {
    console.error('[leads] enrichPendingLeads failed:', err);
    next(err);
  }
}
