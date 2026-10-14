import { UnrecoverableError, Worker } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { QUEUE } from '../queues/index.js';
import { Lead } from '../models/Lead.js';
import { EmailMessage } from '../models/EmailMessage.js';
import { getSettings } from '../models/Settings.js';
import { Product } from '../models/Product.js';
import { aiConfigured, aiModel, draftEmail } from '../services/ai.js';
import { errorMessage, isLastAttempt } from './util.js';
import { publishEvent } from '../services/events.js';

/** Claude writes a personalised first email; it is saved as a draft for a human to approve. */
export const createDraftWorker = () =>
  new Worker(
    QUEUE.draft,
    async (job) => {
      const lead = await Lead.findById(job.data.leadId);
      if (!lead) return;

      try {
        if (!aiConfigured()) throw new UnrecoverableError('ANTHROPIC_API_KEY is not set');
        const to = lead.ai?.recommendedEmail || lead.emails[0]?.address;
        if (!to) throw new UnrecoverableError('Lead has no email address');
        // Research scored 0 = our own company, a competitor or not a real prospect — never email them
        if (lead.ai?.analyzedAt && lead.ai.fitScore === 0) {
          throw new UnrecoverableError('AI scored this lead 0 (e.g. your own company or a competitor), so no email was written');
        }

        const product = await Product.findById(lead.productId);
        if (!product) throw new UnrecoverableError('The product for this lead was deleted');
        const settings = await getSettings();
        const { model: _model, analyzedAt: _at, ...research } = lead.toObject().ai ?? {};
        const draft = await draftEmail(
          {
            organisationName: lead.name,
            city: lead.city,
            contactPersonName: lead.ai?.contactPersonName,
            contactPersonTitle: lead.ai?.contactPersonTitle,
            research: research ?? null,
          },
          product.toObject(),
          settings.toObject(),
        );

        if (draft.skip) {
          lead.pipelineError = `Email not drafted: ${draft.skipReason || 'the AI decided this lead should not be emailed'}`;
          await lead.save();
          publishEvent('lead', { id: String(lead._id) });
          return;
        }

        // Regenerating replaces the pending draft instead of piling up duplicates
        await EmailMessage.findOneAndUpdate(
          { leadId: lead._id, status: 'draft' },
          { $set: { to, subject: draft.subject, body: draft.body, model: aiModel, error: undefined } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        if (/^Email (draft failed|not drafted)/.test(lead.pipelineError ?? '')) {
          lead.pipelineError = undefined; // an earlier drafting problem is resolved
          await lead.save();
        }
        publishEvent('email', { leadId: String(lead._id) });
      } catch (err) {
        if (isLastAttempt(job) || err instanceof UnrecoverableError) {
          lead.pipelineError = `Email draft failed: ${errorMessage(err)}`;
          await lead.save();
          publishEvent('lead', { id: String(lead._id) });
        }
        throw err;
      }
    },
    { connection: redisConnection(), concurrency: 2 },
  );
