import { createDiscoverWorker } from './discover.worker.js';
import { createEnrichWorker } from './enrich.worker.js';
import { createDraftWorker } from './draft.worker.js';
import { createSendWorker } from './send.worker.js';

export function startWorkers() {
  const workers = [createDiscoverWorker(), createEnrichWorker(), createDraftWorker(), createSendWorker()];
  for (const w of workers) {
    w.on('failed', (job, err) => console.warn(`⚠️  [${w.name}] job ${job?.id} failed: ${err.message}`));
    w.on('error', (err) => console.error(`❌ [${w.name}] worker error: ${err.message}`));
  }
  console.log('✅ Queue workers started');
  return workers;
}
