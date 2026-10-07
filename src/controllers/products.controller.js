import { z } from 'zod';
import mongoose from 'mongoose';
import { Product } from '../models/Product.js';
import { Lead } from '../models/Lead.js';
import { Search } from '../models/Search.js';
import { HttpError } from '../middleware/error.js';
import { publishEvent } from '../services/events.js';

const productSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().min(20, 'Describe what the product does (at least 20 characters)').max(5000),
  targetCustomer: z.string().trim().max(1000).default(''),
  signals: z
    .array(z.string().trim().min(1).max(80))
    .max(10)
    .default([])
    .transform((list) => [...new Set(list)]),
  callToAction: z.string().trim().min(5).max(300).default('Ask for a 20-minute online demo this week.'),
  website: z.string().trim().max(300).default(''),
});

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function findProductOr404(id) {
  const product = await Product.findById(id);
  if (!product) throw new HttpError(404, 'Product not found');
  return product;
}

/** Product names must be unique (ignoring case) so the product picker is unambiguous. */
async function assertNameFree(name, exceptId) {
  const clash = await Product.exists({
    name: new RegExp(`^${escapeRegex(name)}$`, 'i'),
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  });
  if (clash) throw new HttpError(409, `A product called "${name}" already exists`);
}

// Errors are passed to next() so the central error handler (middleware/error.js)
// turns validation errors into 400, HttpError into its status, and anything else into 500.

/** GET /api/products — all products with how many leads and searches each has. */
export async function listProducts(_req, res, next) {
  try {
    const [products, leadCounts, searchCounts] = await Promise.all([
      Product.find().sort({ createdAt: 1 }).lean(),
      Lead.aggregate([{ $group: { _id: '$productId', n: { $sum: 1 } } }]),
      Search.aggregate([{ $group: { _id: '$productId', n: { $sum: 1 } } }]),
    ]);
    const leads = new Map(leadCounts.map((c) => [String(c._id), c.n]));
    const searches = new Map(searchCounts.map((c) => [String(c._id), c.n]));
    res.json(
      products.map((p) => ({ ...p, leadCount: leads.get(String(p._id)) ?? 0, searchCount: searches.get(String(p._id)) ?? 0 })),
    );
  } catch (err) {
    console.error('[products] listProducts failed:', err);
    next(err);
  }
}

/** GET /api/products/:id */
export async function getProduct(req, res, next) {
  try {
    res.json(await findProductOr404(req.params.id));
  } catch (err) {
    console.error('[products] getProduct failed:', err);
    next(err);
  }
}

/** POST /api/products */
export async function createProduct(req, res, next) {
  try {
    const body = productSchema.parse(req.body);
    await assertNameFree(body.name);
    const product = await Product.create(body);
    publishEvent('product', { id: String(product._id) });
    res.status(201).json(product);
  } catch (err) {
    console.error('[products] createProduct failed:', err);
    next(err);
  }
}

/** PUT /api/products/:id — replaces the editable fields. */
export async function updateProduct(req, res, next) {
  try {
    const body = productSchema.parse(req.body);
    const product = await findProductOr404(req.params.id);
    await assertNameFree(body.name, product._id);
    Object.assign(product, body);
    await product.save();
    publishEvent('product', { id: String(product._id) });
    res.json(product);
  } catch (err) {
    console.error('[products] updateProduct failed:', err);
    next(err);
  }
}

/** DELETE /api/products/:id — only when no leads belong to it (their research and emails depend on it). */
export async function deleteProduct(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, 'Invalid product id');
    const product = await findProductOr404(req.params.id);
    const leadCount = await Lead.countDocuments({ productId: product._id });
    if (leadCount) {
      throw new HttpError(409, `"${product.name}" has ${leadCount} leads, so it can't be deleted`);
    }
    await Search.deleteMany({ productId: product._id });
    await product.deleteOne();
    publishEvent('product', { id: String(product._id) });
    res.status(204).end();
  } catch (err) {
    console.error('[products] deleteProduct failed:', err);
    next(err);
  }
}
