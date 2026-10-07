import { Schema, model } from 'mongoose';

const unsubscribeSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  },
  { timestamps: true },
);

export const Unsubscribe = model('Unsubscribe', unsubscribeSchema);
