import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { QUEUE, enqueueEnrich } from '../queues/index.js';
import { Search } from '../models/Search.js';
import { Lead } from '../models/Lead.js';
import { discover } from '../services/discovery/index.js';
import { isLastAttempt } from './util.js';
import { publishEvent } from '../services/events.js';

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export const createDiscoverWorker = () =>
  new Worker(
    QUEUE.discover,
    async (job) => {
      const search = await Search.findById(job.data.searchId);
      if (!search) return;

      search.status = 'running';
      search.error = undefined;
      await search.save();
      publishEvent('search', { id: String(search._id) });

      try {
        const { places, note } = await discover(search.source, {
          query: search.query,
          location: search.location,
          keywords: search.keywords,
          maxResults: search.maxResults,
        });

        let created = 0;
        const toEnrich = [];

        for (const p of places) {
          const res = await Lead.updateOne(
            { productId: search.productId, source: search.source, externalId: p.externalId },
            {
              $setOnInsert: {
                productId: search.productId,
                searchId: search._id,
                source: search.source,
                externalId: p.externalId,
                name: p.name,
                address: p.address,
                city: p.city,
                state: p.state,
                lat: p.lat,
                lng: p.lng,
                website: p.website,
                phones: p.phones,
                emails: p.emails
                  .filter((e) => VALID_EMAIL.test(e))
                  .map((address) => ({
                    address: address.toLowerCase(),
                    source: search.source === 'osm' ? 'osm' : 'manual',
                  })),
                beds: p.beds,
                pipelineStatus: p.website ? 'new' : 'no_website',
              },
            },
            { upsert: true },
          );
          if (res.upsertedId) {
            created++;
            if (p.website) toEnrich.push(String(res.upsertedId));
          }
        }

        await Promise.all(toEnrich.map(enqueueEnrich));

        search.note = note;
        search.found = places.length;
        search.created = created;
        search.duplicates = places.length - created;
        search.status = 'done';
        search.finishedAt = new Date();
        await search.save();
        publishEvent('search', { id: String(search._id) });
      } catch (err) {
        if (isLastAttempt(job)) {
          search.status = 'failed';
          search.error = err.message;
          await search.save();
          publishEvent('search', { id: String(search._id) });
        }
        throw err;
      }
    },
    { connection: redisConnection(), concurrency: 2 },
  );
