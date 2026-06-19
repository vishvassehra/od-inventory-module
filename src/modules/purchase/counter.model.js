const mongoose = require('mongoose');

/**
 * Generates sequential document numbers per tenant per series.
 * Series examples: PR, PO, GRN, SIV (Stock Issue Voucher)
 *
 * Format: {PREFIX}/{YY-YY}/{SEQ}  e.g. PR/25-26/0001
 *
 * Usage:
 *   const no = await Counter.next(tenantId, 'PR', fyYear);
 *   // returns "PR/25-26/0001"
 */

const counterSchema = new mongoose.Schema({
  _id: { type: String }, // composite key: tenantId:series:fy
  seq: { type: Number, default: 0 },
});

counterSchema.statics.next = async function (tenantId, prefix, fy) {
  const id = `${tenantId}:${prefix}:${fy}`;
  const doc = await this.findByIdAndUpdate(
    id,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `${prefix}/${fy}/${String(doc.seq).padStart(4, '0')}`;
};

// Get current FY string e.g. "25-26"
counterSchema.statics.currentFY = function (fyStartMonth = 4) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-based
  const startYear = month >= fyStartMonth ? year : year - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
};

module.exports = mongoose.model('Counter', counterSchema);
