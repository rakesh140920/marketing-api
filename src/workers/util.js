/** True when this run is the job's final retry, so failures should be recorded permanently. */
export const isLastAttempt = (job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

export const errorMessage = (err) => (err instanceof Error ? err.message : String(err)).slice(0, 500);
