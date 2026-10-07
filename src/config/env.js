import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:5000'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  GOOGLE_PLACES_API_KEY: z.string().optional(),
  CRAWLER_USER_AGENT: z.string().default('LeadFinderBot/0.1'),

  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM_NAME: z.string().default('Sales Team'),
  MAIL_FROM_EMAIL: z.string().optional(),
  MAIL_REPLY_TO: z.string().optional(),

  EMAIL_DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  EMAIL_DAILY_LIMIT: z.coerce.number().int().positive().default(40),
  EMAIL_PER_MINUTE: z.coerce.number().int().positive().default(2),

  UNSUBSCRIBE_SECRET: z.string().min(16, 'UNSUBSCRIBE_SECRET must be at least 16 characters'),
});

const parsed = schema.safeParse(
  // Treat empty strings in .env as "not set"
  Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')),
);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`   ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
