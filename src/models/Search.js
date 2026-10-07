import { Schema, model, Types } from 'mongoose';

export const SEARCH_SOURCES = ['osm', 'google'];

const searchSchema = new Schema(
  {
    // The product this search finds prospects for
    productId: { type: Types.ObjectId, ref: 'Product', required: true, index: true },
    source: { type: String, enum: SEARCH_SOURCES, required: true },
    query: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    // Optional extra words that narrow the search (e.g. "ICU", "cashless", "eye")
    keywords: { type: [String], default: [] },
    maxResults: { type: Number, default: 60 },
    status: {
      type: String,
      enum: ['queued', 'running', 'done', 'failed'],
      default: 'queued',
      index: true,
    },
    found: { type: Number, default: 0 },
    created: { type: Number, default: 0 },
    duplicates: { type: Number, default: 0 },
    // What was actually searched / any fallback applied, shown in the UI
    note: { type: String },
    error: { type: String },
    finishedAt: { type: Date },
  },
  { timestamps: true },
);

export const Search = model('Search', searchSchema);
