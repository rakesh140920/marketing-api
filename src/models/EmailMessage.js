import { Schema, model, Types } from 'mongoose';

export const EMAIL_STATUSES = [
  'draft', // written by AI, waiting for a human
  'approved', // human approved, queued for sending
  'sent',
  'failed',
  'rejected',
];

const emailMessageSchema = new Schema(
  {
    leadId: { type: Types.ObjectId, ref: 'Lead', required: true, index: true },
    to: { type: String, lowercase: true, trim: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    status: { type: String, enum: EMAIL_STATUSES, default: 'draft', index: true },
    model: String,
    approvedAt: Date,
    sentAt: { type: Date, index: true },
    providerMessageId: String,
    dryRun: Boolean,
    // Sent in test mode: delivered to the test addresses below instead of `to`
    testMode: Boolean,
    deliveredTo: { type: [String], default: undefined },
    error: String,
  },
  { timestamps: true },
);

export const EmailMessage = model('EmailMessage', emailMessageSchema);
