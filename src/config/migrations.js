import { Product } from '../models/Product.js';
import { Settings } from '../models/Settings.js';
import { Lead } from '../models/Lead.js';
import { Search } from '../models/Search.js';

/**
 * One-time data upgrades, run on every start (each step is a no-op once done).
 *
 * v2 — multi-product: product details moved from Settings to their own Product records,
 * and every search / lead now belongs to a product.
 */
export async function runMigrations() {
  const legacy = await Settings.collection.findOne({ key: 'global' });
  let product = await Product.findOne().sort({ createdAt: 1 });

  // 1. Turn the old single-product settings into the first Product
  const hasOldData = legacy?.productName || (await Lead.estimatedDocumentCount()) > 0;
  if (!product && hasOldData) {
    product = await Product.create({
      name: legacy?.productName || 'VitalBase',
      description:
        legacy?.productPitch || 'VitalBase is a hospital management software (HMS/HMIS) for Indian hospitals and clinics.',
      targetCustomer: legacy?.targetCustomer || '',
      callToAction: legacy?.callToAction || undefined,
      signals: ['ABDM / ABHA', 'NHCX', 'Cashless / insurance tie-ups'],
    });
    console.log(`🔧 Migration: created product "${product.name}" from the old settings`);
  }

  // 2. Link existing searches and leads to it
  if (product) {
    const [s, l] = await Promise.all([
      Search.updateMany({ productId: { $exists: false } }, { $set: { productId: product._id } }),
      Lead.updateMany({ productId: { $exists: false } }, { $set: { productId: product._id } }),
    ]);
    if (s.modifiedCount || l.modifiedCount) {
      console.log(`🔧 Migration: linked ${s.modifiedCount} searches and ${l.modifiedCount} leads to "${product.name}"`);
    }
  }

  // 3. Leads are now unique per product, not globally — drop the old index
  const indexes = await Lead.collection.indexes().catch(() => []);
  if (indexes.some((i) => i.name === 'source_1_externalId_1')) {
    await Lead.collection.dropIndex('source_1_externalId_1');
    console.log('🔧 Migration: leads are now unique per product');
  }
  await Lead.createIndexes();

  // 4. Product fields no longer live in Settings
  if (legacy?.productName !== undefined) {
    await Settings.collection.updateOne(
      { key: 'global' },
      { $unset: { productName: '', productPitch: '', targetCustomer: '', callToAction: '' } },
    );
  }
}
