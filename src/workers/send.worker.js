import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { env } from '../config/env.js';
import { QUEUE, enqueueSend } from '../queues/index.js';
import { EmailMessage } from '../models/EmailMessage.js';
import { Lead } from '../models/Lead.js';
import { Unsubscribe } from '../models/Unsubscribe.js';
import { getSettings } from '../models/Settings.js';
import { sendMail, withFooter } from '../services/mailer.js';
import { errorMessage, isLastAttempt } from './util.js';
import { publishEvent } from '../services/events.js';

/** One line per email in the backend terminal, e.g. 📧 [LIVE] Sunrise Hospital → info@… · "Subject" */
function logEmail(icon, label, lead, detail, subject) {
  console.log(`${icon} [${label}] ${lead?.name ?? 'Unknown lead'} → ${detail} · "${subject}"`);
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Sends approved emails one at a time, within the per-minute and per-day limits. */
export const createSendWorker = () =>
  new Worker(
    QUEUE.send,
    async (job) => {
      const email = await EmailMessage.findById(job.data.emailId);
      if (!email || email.status !== 'approved' || !email.to) return;

      const lead = await Lead.findById(email.leadId);
      if ((await Unsubscribe.exists({ email: email.to })) || lead?.salesStatus === 'do_not_contact') {
        email.status = 'failed';
        email.error = 'Recipient has unsubscribed / is marked do-not-contact';
        await email.save();
        logEmail('🚫', 'SKIPPED', lead, `${email.to} (unsubscribed / do-not-contact)`, email.subject);
        publishEvent('email', { id: String(email._id), leadId: String(email.leadId) });
        return;
      }

      const sentToday = await EmailMessage.countDocuments({
        status: 'sent',
        dryRun: { $ne: true },
        sentAt: { $gte: startOfToday() },
      });
      if (!env.EMAIL_DRY_RUN && sentToday >= env.EMAIL_DAILY_LIMIT) {
        // Daily cap reached — try again shortly after midnight
        const tomorrow = startOfToday().getTime() + 24 * 60 * 60 * 1000;
        await enqueueSend(String(email._id), tomorrow - Date.now() + Math.floor(Math.random() * 30 * 60 * 1000));
        logEmail('⏳', 'POSTPONED', lead, `${email.to} (daily limit ${env.EMAIL_DAILY_LIMIT} reached, retrying after midnight)`, email.subject);
        return;
      }

      const settings = await getSettings();
      const testMode = settings.testMode;
      if (testMode && !settings.testEmails.length) {
        email.status = 'failed';
        email.error = 'Test mode is on but no test email addresses are set (Settings → Test mode)';
        await email.save();
        logEmail('❌', 'NOT SENT', lead, `${email.to} (test mode is on but no test addresses are set)`, email.subject);
        publishEvent('email', { id: String(email._id), leadId: String(email.leadId) });
        return;
      }

      try {
        // Test mode: deliver to the test addresses only, and say who it would have gone to.
        // The unsubscribe link belongs to the test address, so clicking it can't opt out the real lead.
        const result = testMode
          ? await sendMail({
              to: settings.testEmails,
              subject: `[TEST] ${email.subject}`,
              text:
                `⚠️ TEST MODE — in live mode this email would be sent to ${email.to}\n\n` +
                withFooter(email.body, settings.signature, settings.testEmails[0]),
              unsubscribeFor: settings.testEmails[0],
            })
          : await sendMail({
              to: email.to,
              subject: email.subject,
              text: withFooter(email.body, settings.signature, email.to),
            });

        email.status = 'sent';
        email.sentAt = new Date();
        email.providerMessageId = result.messageId;
        email.dryRun = result.dryRun;
        email.testMode = testMode;
        email.deliveredTo = testMode ? settings.testEmails : [email.to];
        email.error = undefined;
        await email.save();

        if (result.dryRun) {
          logEmail('📭', 'DRY RUN', lead, `${email.deliveredTo.join(', ')} (not delivered — EMAIL_DRY_RUN=true)`, email.subject);
        } else if (testMode) {
          logEmail('🧪', 'TEST', lead, `${email.deliveredTo.join(', ')} (meant for ${email.to})`, email.subject);
        } else {
          logEmail('📧', 'SENT', lead, email.to, email.subject);
        }

        // A test send hasn't contacted the lead
        if (!testMode && lead && lead.salesStatus === 'open') {
          lead.salesStatus = 'contacted';
          await lead.save();
        }
        publishEvent('email', { id: String(email._id), leadId: String(email.leadId) });
      } catch (err) {
        const target = testMode ? `${settings.testEmails.join(', ')} (meant for ${email.to})` : email.to;
        const willRetry = !isLastAttempt(job);
        logEmail('❌', willRetry ? 'FAILED, WILL RETRY' : 'FAILED', lead, `${target} — ${errorMessage(err)}`, email.subject);
        if (isLastAttempt(job)) {
          email.status = 'failed';
          email.error = errorMessage(err);
          await email.save();
          publishEvent('email', { id: String(email._id), leadId: String(email.leadId) });
        }
        throw err;
      }
    },
    {
      connection: redisConnection(),
      concurrency: 1,
      limiter: { max: env.EMAIL_PER_MINUTE, duration: 60_000 },
    },
  );
