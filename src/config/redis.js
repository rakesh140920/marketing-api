import { env } from './env.js';

/** BullMQ connection options parsed from REDIS_URL (redis://user:pass@host:port/db). */
export function redisConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    // Required by BullMQ workers
    maxRetriesPerRequest: null,
  };
}
