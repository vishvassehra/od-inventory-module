const mongoose = require('mongoose');

// Auto-generate item code: prefix from category code + sequence
// e.g. FURN-0001, STAT-0042
const itemSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    itemCode: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: null },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Category is required'],
    },
    uomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UOM',
      required: [true, 'Unit of measure is required'],
    },
    hsnCode: { type: String, trim: true, default: null },  // HSN for GST
    // Stock control
    reorderQty: { type: Number, default: 0, min: 0 },
    minStock: { type: Number, default: 0, min: 0 },
    maxStock: { type: Number, default: null, min: 0 },
    // Type flags
    isAsset: { type: Boolean, default: false },       // If true → individual asset records on GRN
    isConsumable: { type: Boolean, default: true },
    // Last purchase rate — updated on every GRN for quick reference
    lastPurchaseRate: { type: Number, default: null },
    lastPurchaseDate: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

itemSchema.index({ tenantId: 1, itemCode: 1 }, { unique: true });
itemSchema.index({ tenantId: 1, categoryId: 1 });
itemSchema.index({ tenantId: 1, name: 'text' }); // text search on name

module.exports = mongoose.model('Item', itemSchema);
