import { z } from 'zod';
import { env } from '../config/env.js';
import { Search, SEARCH_SOURCES } from '../models/Search.js';
import { Product } from '../models/Product.js';
import { Lead } from '../models/Lead.js';
import { discoverQueue } from '../queues/index.js';
import { HttpError } from '../middleware/error.js';
import { publishEvent } from '../services/events.js';

const createSchema = z.object({
  productId: z.string({ error: 'Choose which product this search is for' }).regex(/^[a-f0-9]{24}$/i, 'Invalid product'),
  source: z.enum(SEARCH_SOURCES),
  query: z.string({ error: 'Say what kind of organisations to find' }).trim().min(2).max(100),
  location: z.string().trim().min(2).max(120),
  keywords: z
    .array(z.string().trim().max(60))
    .max(5)
    .default([])
    .transform((list) => [...new Set(list.filter(Boolean))]),
  maxResults: z.coerce.number().int().min(1).max(500).default(60),
});

/** Per-search counts of leads in each pipeline stage, for progress bars. */
async function progressFor(ids) {
  const rows = await Lead.aggregate([
    { $match: { searchId: { $in: ids } } },
    { $group: { _id: { s: '$searchId', p: '$pipelineStatus' }, n: { $sum: 1 } } },
  ]);
  const map = new Map();
  for (const r of rows) {
    const key = String(r._id.s);
    map.set(key, { ...(map.get(key) ?? {}), [r._id.p]: r.n });
  }
  return map;
}

// Errors are passed to next() so the central error handler (middleware/error.js)
// turns validation errors into 400, HttpError into its status, and anything else into 500.

/** POST /api/searches — start a new discovery search (runs in the background queue). */
export async function createSearch(req, res, next) {
  try {
    const body = createSchema.parse(req.body);
    if (!(await Product.exists({ _id: body.productId }))) throw new HttpError(400, 'That product no longer exists');
    if (body.source === 'google') {
      if (!env.GOOGLE_PLACES_API_KEY) throw new HttpError(400, 'Google Places is not configured (GOOGLE_PLACES_API_KEY)');
      body.maxResults = Math.min(body.maxResults, 60); // Google returns max 60 per query
    }
    const search = await Search.create(body);
    await discoverQueue.add('discover', { searchId: String(search._id) });
    publishEvent('search', { id: String(search._id) });
    res.status(201).json(search);
  } catch (err) {
    console.error('[searches] createSearch failed:', err);
    next(err);
  }
}

/** GET /api/searches — latest 50 searches with research progress. */
export async function listSearches(_req, res, next) {
  try {
    const searches = await Search.find().sort({ createdAt: -1 }).limit(50).lean();
    const progress = await progressFor(searches.map((s) => s._id));
    res.json(searches.map((s) => ({ ...s, progress: progress.get(String(s._id)) ?? {} })));
  } catch (err) {
    console.error('[searches] listSearches failed:', err);
    next(err);
  }
}

/** GET /api/searches/:id — one search with research progress. */
export async function getSearch(req, res, next) {
  try {
    const search = await Search.findById(req.params.id).lean();
    if (!search) throw new HttpError(404, 'Search not found');
    const progress = await progressFor([search._id]);
    res.json({ ...search, progress: progress.get(String(search._id)) ?? {} });
  } catch (err) {
    console.error('[searches] getSearch failed:', err);
    next(err);
  }
}
