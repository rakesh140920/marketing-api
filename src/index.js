import mongoose from 'mongoose';
import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { runMigrations } from './config/migrations.js';
import { createApp } from './app.js';
import { startWorkers } from './workers/index.js';
import { closeQueues } from './queues/index.js';
import { closeEvents } from './services/events.js';

async function main() {
  await connectDb();
  await runMigrations();
  const workers = startWorkers();

  const server = createApp().listen(env.PORT, () => {
    console.log(`🚀 API listening on http://localhost:${env.PORT}`);
    if (env.EMAIL_DRY_RUN) console.log('📭 EMAIL_DRY_RUN is on — approved emails are logged, not sent');
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down…`);
    // If Redis or MongoDB is unreachable, closing can hang — don't wait forever
    setTimeout(() => {
      console.error('⚠️  Shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000).unref();
    await closeEvents(); // end open SSE streams first, otherwise server.close() waits for them
    server.close();
    await Promise.allSettled(workers.map((w) => w.close()));
    await closeQueues();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('❌ Failed to start:', err);
  process.exit(1);
});
