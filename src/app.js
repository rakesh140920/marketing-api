import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import searches from './routes/searches.js';
import leads from './routes/leads.js';
import emails from './routes/emails.js';
import settings from './routes/settings.js';
import stats from './routes/stats.js';
import unsubscribe from './routes/unsubscribe.js';
import events from './routes/events.js';
import products from './routes/products.js';
import { errorHandler, notFound } from './middleware/error.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN.split(',').map((s) => s.trim()) }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/products', products);
  app.use('/api/searches', searches);
  app.use('/api/leads', leads);
  app.use('/api/emails', emails);
  app.use('/api/settings', settings);
  app.use('/api/stats', stats);
  app.use('/api/events', events);
  app.use('/u', unsubscribe);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
