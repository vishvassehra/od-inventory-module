const mongoose = require('mongoose');

const adjustmentLineSchema = new mongoose.Schema({
  itemId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  uomId:       { type: mongoose.Schema.Types.ObjectId, ref: 'UOM' },
  warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  // adjType: 'add' = surplus, 'sub' = shortage write-off
  adjType:     { type: String, enum: ['add', 'sub'], required: true },
  qty:         { type: Number, required: true, min: 0.01 },
  remarks:     { type: String },
}, { _id: false });

const stockAdjustmentSchema = new mongoose.Schema({
  tenantId:         { type: String, required: true, index: true },
  adjustmentNumber: { type: String, required: true },
  reason:           { type: String, required: true },
  lines:            { type: [adjustmentLineSchema], required: true },
  remarks:          { type: String },
  // Always auto-posted on creation — no draft state
  postedAt:         { type: Date, default: Date.now },
  createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

stockAdjustmentSchema.index({ tenantId: 1, createdAt: -1 });
stockAdjustmentSchema.index({ tenantId: 1, adjustmentNumber: 1 }, { unique: true });

module.exports = mongoose.model('StockAdjustment', stockAdjustmentSchema);
