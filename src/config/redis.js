import Redis from 'ioredis';
import { env } from './env.js';

/**
 * Redis connection options for BullMQ queues/workers and live updates.
 * Uses REDIS_HOST / REDIS_PORT / REDIS_PASSWORD (… USERNAME, DB, TLS) when REDIS_HOST is set,
 * otherwise parses REDIS_URL (redis://user:pass@host:port/db). Separate variables avoid having to
 * URL-encode passwords that contain characters like @ or #.
 */
export function redisConnection() {
  const base = env.REDIS_HOST
    ? {
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        username: env.REDIS_USERNAME || undefined,
        password: env.REDIS_PASSWORD || undefined,
        db: env.REDIS_DB,
        tls: env.REDIS_TLS ? {} : undefined,
      }
    : parseRedisUrl(env.REDIS_URL);
  // Required by BullMQ workers
  return { ...base, maxRetriesPerRequest: null };
}

function parseRedisUrl(raw) {
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  };
}

/** "host:port" for logs — never includes the password. */
export const redisTarget = () => {
  const { host, port } = redisConnection();
  return `${host}:${port}`;
};

/** Log on startup whether Redis is reachable, so a wrong host or password shows up immediately. */
export async function verifyRedis() {
  const client = new Redis({
    ...redisConnection(),
    lazyConnect: true,
    connectTimeout: 10_000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  client.on('error', () => {}); // reported below instead
  try {
    await client.connect();
    await client.ping();
    console.log(`✅ Redis connected (${redisTarget()})`);
    // BullMQ needs Redis to never evict keys, or queued jobs can silently disappear
    const policy = await client.config('GET', 'maxmemory-policy').catch(() => null);
    if (policy?.[1] && policy[1] !== 'noeviction') {
      console.warn(
        `⚠️  Redis maxmemory-policy is "${policy[1]}" — set it to "noeviction" so queued jobs are never dropped`,
      );
    }
  } catch (err) {
    const msg = /WRONGPASS|NOAUTH|invalid password/i.test(err.message)
      ? 'wrong or missing REDIS_PASSWORD'
      : /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|connect/i.test(err.message)
        ? `cannot reach ${redisTarget()} — check REDIS_HOST / REDIS_PORT and the server firewall`
        : err.message;
    console.error(`❌ Redis check failed: ${msg}`);
  } finally {
    client.disconnect();
  }
}
