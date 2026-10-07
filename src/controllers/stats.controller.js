import { env } from '../config/env.js';
import { Lead } from '../models/Lead.js';
import { EmailMessage } from '../models/EmailMessage.js';
import { aiConfigured, aiModel } from '../services/ai.js';
import { smtpConfigured } from '../services/mailer.js';
import { getSettings } from '../models/Settings.js';

/** Leads with an AI fit score at or above this count as "good fit" on the dashboard. */
export const QUALIFIED_SCORE = 60;

// Errors are passed to next() so the central error handler (middleware/error.js)
// turns validation errors into 400, HttpError into its status, and anything else into 500.

/** GET /api/stats — dashboard numbers: prospecting funnel, email counts, sending limits, config status. */
export async function getStats(_req, res, next) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [settings, leads, withWebsite, withEmail, researched, qualified, emailCounts, sentToday] = await Promise.all([
      getSettings(),
      Lead.countDocuments(),
      Lead.countDocuments({ website: { $nin: [null, ''] } }),
      Lead.countDocuments({ 'emails.0': { $exists: true } }),
      Lead.countDocuments({ 'ai.analyzedAt': { $exists: true } }),
      Lead.countDocuments({ 'ai.fitScore': { $gte: QUALIFIED_SCORE } }),
      EmailMessage.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      EmailMessage.countDocuments({ status: 'sent', dryRun: { $ne: true }, sentAt: { $gte: today } }),
    ]);

    const emails = Object.fromEntries(emailCounts.map((e) => [e._id, e.n]));

    res.json({
      funnel: { leads, withWebsite, withEmail, researched, qualified, sent: emails.sent ?? 0 },
      emails: {
        draft: emails.draft ?? 0,
        approved: emails.approved ?? 0,
        sent: emails.sent ?? 0,
        failed: emails.failed ?? 0,
        rejected: emails.rejected ?? 0,
      },
      sending: {
        sentToday,
        dailyLimit: env.EMAIL_DAILY_LIMIT,
        perMinute: env.EMAIL_PER_MINUTE,
        dryRun: env.EMAIL_DRY_RUN,
        testMode: settings.testMode,
        testEmails: settings.testEmails,
      },
      config: {
        googlePlaces: Boolean(env.GOOGLE_PLACES_API_KEY),
        ai: aiConfigured(),
        aiModel,
        smtp: smtpConfigured(),
      },
      qualifiedScore: QUALIFIED_SCORE,
    });
  } catch (err) {
    console.error('[stats] getStats failed:', err);
    next(err);
  }
}
