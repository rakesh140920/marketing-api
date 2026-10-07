import { Schema, model } from 'mongoose';

/**
 * A product we market. Every search is run for one product; the AI uses these details to
 * judge how well each prospect fits and to write the outreach email.
 */
const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // What it does — features, integrations, pricing hints, customer proof. The AI only claims what is written here.
    description: { type: String, required: true, trim: true },
    // Who should buy it, e.g. "Private hospitals in India with 20–300 beds"
    targetCustomer: { type: String, default: '', trim: true },
    // Things to look for on a prospect's website that suggest they need the product, e.g. "ABDM", "NHCX"
    signals: { type: [String], default: [] },
    callToAction: { type: String, default: 'Ask for a 20-minute online demo this week.', trim: true },
    website: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

export const Product = model('Product', productSchema);
