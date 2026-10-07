import { Schema, model, Types } from 'mongoose';
import { SEARCH_SOURCES } from './Search.js';

export const PIPELINE_STATUSES = [
  'new', // discovered, waiting for enrichment
  'crawling',
  'analyzing',
  'ready', // crawled + AI analysed
  'no_website',
  'failed',
];

export const SALES_STATUSES = ['open', 'contacted', 'replied', 'not_interested', 'do_not_contact'];

const emailSchema = new Schema(
  {
    address: { type: String, required: true, lowercase: true, trim: true },
    // where we found it: website page, OSM tag, AI-picked, typed by a user
    source: { type: String, enum: ['website', 'osm', 'manual'], default: 'website' },
    page: { type: String },
  },
  { _id: false },
);

const signalSchema = new Schema(
  {
    name: String, // one of the product's buying signals
    found: Boolean,
    evidence: String, // short quote / reason from the website
  },
  { _id: false },
);

const aiSchema = new Schema(
  {
    productName: String, // product the lead was analysed against
    summary: String,
    businessType: String,
    size: String, // e.g. "120 beds", "50 employees"
    offerings: [String], // services / departments / products they offer
    existingSolutions: String, // tools or vendors they already use in our product's space
    signals: [signalSchema],
    // Older hospital-only analyses (kept so existing leads still display)
    hospitalType: String,
    bedCount: Number,
    specialties: [String],
    existingSoftware: String,
    mentionsABDM: Boolean,
    mentionsNHCX: Boolean,
    mentionsInsurance: Boolean,
    contactPersonName: String,
    contactPersonTitle: String,
    recommendedEmail: String,
    fitScore: Number,
    fitReasons: [String],
    model: String,
    analyzedAt: Date,
  },
  { _id: false },
);

const leadSchema = new Schema(
  {
    // A business can be a lead for several products — each with its own research and emails
    productId: { type: Types.ObjectId, ref: 'Product', required: true, index: true },
    searchId: { type: Types.ObjectId, ref: 'Search', index: true },
    source: { type: String, enum: SEARCH_SOURCES, required: true },
    // Google place_id or OSM "node/123" — unique per product + source
    externalId: { type: String, required: true },

    name: { type: String, required: true, trim: true },
    address: String,
    city: String,
    state: String,
    lat: Number,
    lng: Number,
    website: String,
    phones: { type: [String], default: [] },
    emails: { type: [emailSchema], default: [] },
    beds: Number, // from OSM "beds" tag when present (hospitals)

    pipelineStatus: { type: String, enum: PIPELINE_STATUSES, default: 'new', index: true },
    salesStatus: { type: String, enum: SALES_STATUSES, default: 'open', index: true },
    pipelineError: String,

    crawledPages: { type: [String], default: [] },
    crawledAt: Date,

    ai: { type: aiSchema },
    notes: String,
  },
  { timestamps: true },
);

leadSchema.index({ productId: 1, source: 1, externalId: 1 }, { unique: true });
leadSchema.index({ 'ai.fitScore': -1 });
leadSchema.index({ name: 'text', city: 'text', address: 'text' });

export const Lead = model('Lead', leadSchema);
