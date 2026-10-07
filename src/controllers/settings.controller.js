import { z } from 'zod';
import { Settings, getSettings as loadSettings } from '../models/Settings.js';
import { publishEvent } from '../services/events.js';

const updateSchema = z
  .object({
    companyName: z.string().trim().max(100),
    senderName: z.string().trim().max(100),
    senderTitle: z.string().trim().max(100),
    signature: z.string().trim().max(1000),
  })
  .partial();

// Errors are passed to next() so the central error handler (middleware/error.js)
// turns validation errors into 400, HttpError into its status, and anything else into 500.

/** GET /api/settings — company and sender details used in every email (created with defaults on first read). */
export async function getSettings(_req, res, next) {
  try {
    res.json(await loadSettings());
  } catch (err) {
    console.error('[settings] getSettings failed:', err);
    next(err);
  }
}

/** PUT /api/settings — update any of the fields above. */
export async function updateSettings(req, res, next) {
  try {
    const body = updateSchema.parse(req.body);
    await loadSettings(); // make sure the single settings document exists
    const updated = await Settings.findOneAndUpdate({ key: 'global' }, { $set: body }, { new: true });
    publishEvent('settings');
    res.json(updated);
  } catch (err) {
    console.error('[settings] updateSettings failed:', err);
    next(err);
  }
}
