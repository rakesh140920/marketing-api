import { Schema, model } from 'mongoose';

/** Single document with company-wide details used in every email. Product details live in Product. */
const settingsSchema = new Schema(
  {
    key: { type: String, default: 'global', unique: true },
    companyName: { type: String, default: 'CHIPSY' },
    senderName: { type: String, default: '' },
    senderTitle: { type: String, default: '' },
    signature: { type: String, default: '' },
  },
  { timestamps: true },
);

export const Settings = model('Settings', settingsSchema);

export async function getSettings() {
  return Settings.findOneAndUpdate(
    { key: 'global' },
    { $setOnInsert: { key: 'global' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}
