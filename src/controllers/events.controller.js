import { addClient, removeClient } from '../services/events.js';

/** Comment line sent periodically so proxies and browsers keep the idle connection open. */
const HEARTBEAT_MS = 25_000;

/**
 * GET /api/events — Server-Sent Events stream.
 * Each message is `data: {"type":"lead"|"email"|"search"|"settings", ...ids}`;
 * the first one is `{"type":"ready"}` so the browser knows it is connected.
 */
export function streamEvents(req, res, next) {
  try {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // tell Nginx not to buffer this response
    });
    res.flushHeaders();
    res.write('retry: 5000\n\n'); // browser waits 5 s before reconnecting after a drop
    res.write(`data: ${JSON.stringify({ type: 'ready' })}\n\n`);

    addClient(res);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    res.on('close', () => {
      clearInterval(heartbeat);
      removeClient(res);
    });
  } catch (err) {
    console.error('[events] streamEvents failed:', err);
    if (res.headersSent) res.end();
    else next(err);
  }
}
