import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis.js';

/**
 * Pipeline:  discover → enrich (crawl website + AI analysis) → draft (AI email) → [human approves] → send
 */
export const QUEUE = {
  discover: 'discover',
  enrich: 'enrich',
  draft: 'draft',
  send: 'send',
};

const connection = redisConnection();

const defaults = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 15_000 },
  // Removing finished jobs lets the same jobId (e.g. re-enrich a lead) be queued again
  removeOnComplete: true,
  removeOnFail: true,
};

export const discoverQueue = new Queue(QUEUE.discover, {
  connection,
  defaultJobOptions: { ...defaults, attempts: 2 },
});
export const enrichQueue = new Queue(QUEUE.enrich, { connection, defaultJobOptions: defaults });
export const draftQueue = new Queue(QUEUE.draft, { connection, defaultJobOptions: defaults });
export const sendQueue = new Queue(QUEUE.send, {
  connection,
  defaultJobOptions: { ...defaults, attempts: 2, backoff: { type: 'fixed', delay: 60_000 } },
});

export const enqueueEnrich = (leadId) => enrichQueue.add('enrich', { leadId }, { jobId: `enrich-${leadId}` });

export const enqueueDraft = (leadId) => draftQueue.add('draft', { leadId }, { jobId: `draft-${leadId}` });

export const enqueueSend = (emailId, delay = 0) =>
  sendQueue.add('send', { emailId }, { jobId: `send-${emailId}-${Date.now()}`, delay });

export async function closeQueues() {
  await Promise.all([discoverQueue.close(), enrichQueue.close(), draftQueue.close(), sendQueue.close()]);
}
