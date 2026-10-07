import Redis from 'ioredis';
import { redisConnection } from '../config/redis.js';

/**
 * Live updates for the frontend.
 *
 *   worker / controller ── publishEvent('lead', {...}) ──► Redis channel ──► every API process
 *                                                                         └─► open SSE connections (GET /api/events)
 *
 * Events only say *what kind* of data changed; the browser then refetches that data.
 * Redis pub/sub sits in the middle so this keeps working when workers run in a separate process.
 */

const CHANNEL = 'vb:events';

/** search · lead · email · product · settings */
export const EVENT_TYPES = ['search', 'lead', 'email', 'product', 'settings'];

let publisher = null;
let subscriber = null;
const clients = new Set();

/**
 * Tell every open browser that something changed. Best-effort: never throws, never blocks the caller.
 * @param {'search' | 'lead' | 'email' | 'product' | 'settings'} type
 * @param {object} [data]  Optional ids, e.g. { id, searchId, leadId }
 */
export function publishEvent(type, data = {}) {
  publisher ??= new Redis(redisConnection());
  publisher
    .publish(CHANNEL, JSON.stringify({ type, ...data }))
    .catch((err) => console.warn(`⚠️  live update not published: ${err.message}`));
}

function ensureSubscriber() {
  if (subscriber) return;
  subscriber = new Redis(redisConnection());
  subscriber.subscribe(CHANNEL).catch((err) => console.error(`❌ live updates: subscribe failed: ${err.message}`));
  subscriber.on('message', (_channel, message) => {
    const frame = `data: ${message}\n\n`;
    for (const res of clients) res.write(frame);
  });
}

/** Register an open SSE response; it receives every event until removed. */
export function addClient(res) {
  ensureSubscriber();
  clients.add(res);
}

export function removeClient(res) {
  clients.delete(res);
}

/** End open streams and Redis connections (graceful shutdown). */
export async function closeEvents() {
  for (const res of clients) res.end();
  clients.clear();
  await Promise.allSettled([publisher?.quit(), subscriber?.quit()]);
}
