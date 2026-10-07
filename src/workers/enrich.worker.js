import { UnrecoverableError, Worker } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { QUEUE } from '../queues/index.js';
import { Lead } from '../models/Lead.js';
import { getSettings } from '../models/Settings.js';
import { Product } from '../models/Product.js';
import { crawlWebsite } from '../services/crawler.js';
import { aiConfigured, aiModel, analyzeLead } from '../services/ai.js';
import { errorMessage, isLastAttempt } from './util.js';
import { publishEvent } from '../services/events.js';

/** Crawl the prospect's own website, then let Claude extract facts and score the lead for its product. */
export const createEnrichWorker = () =>
  new Worker(
    QUEUE.enrich,
    async (job) => {
      const lead = await Lead.findById(job.data.leadId);
      if (!lead?.website) return;
      const notify = () =>
        publishEvent('lead', { id: String(lead._id), searchId: lead.searchId && String(lead.searchId) });

      try {
        lead.pipelineStatus = 'crawling';
        lead.pipelineError = undefined;
        await lead.save();
        notify();

        const crawl = await crawlWebsite(lead.website);

        // Keep emails from map data / typed by users, refresh the ones scraped from the website
        const kept = lead.emails.filter((e) => e.source !== 'website');
        const keptSet = new Set(kept.map((e) => e.address));
        lead.set('emails', [
          ...kept,
          ...crawl.emails
            .filter((e) => !keptSet.has(e.address))
            .map((e) => ({ address: e.address, source: 'website', page: e.page })),
        ]);
        lead.phones = [...new Set([...lead.phones, ...crawl.phones])];
        lead.crawledPages = crawl.pages.map((p) => p.url);
        lead.crawledAt = new Date();

        if (!aiConfigured()) {
          lead.pipelineStatus = 'ready';
          lead.pipelineError = 'Crawled, but AI analysis skipped — ANTHROPIC_API_KEY is not set';
          await lead.save();
          notify();
          return;
        }

        lead.pipelineStatus = 'analyzing';
        await lead.save();
        notify();

        const product = await Product.findById(lead.productId);
        if (!product) throw new UnrecoverableError('The product for this lead was deleted');
        const settings = await getSettings();
        const analysis = await analyzeLead(
          {
            name: lead.name,
            address: lead.address,
            city: lead.city,
            state: lead.state,
            website: crawl.finalUrl,
            bedsFromMap: lead.beds,
            emails: lead.emails.map((e) => e.address),
            phones: lead.phones,
            pages: crawl.pages,
          },
          product.toObject(),
          settings.toObject(),
        );

        lead.set('ai', { ...analysis, productName: product.name, model: aiModel, analyzedAt: new Date() });
        lead.pipelineStatus = 'ready';
        await lead.save();
        notify();
      } catch (err) {
        lead.pipelineError = errorMessage(err);
        lead.pipelineStatus = isLastAttempt(job) || err instanceof UnrecoverableError ? 'failed' : 'new';
        await lead.save();
        notify();
        throw err;
      }
    },
    { connection: redisConnection(), concurrency: 3 },
  );
