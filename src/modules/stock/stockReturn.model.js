const mongoose = require('mongoose');

const returnLineSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  uomId: { type: mongoose.Schema.Types.ObjectId, ref: 'UOM', required: true },
  warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  sivLineId: { type: mongoose.Schema.Types.ObjectId, default: null }, // ref to original SIV line
  returnQty: { type: Number, required: true, min: [0.01, 'Return qty must be > 0'] },
  unitRate: { type: Number, default: 0 },
  condition: {
    type: String,
    enum: ['good', 'damaged', 'unusable'],
    default: 'good',
  },
  remarks: { type: String, trim: true, default: null },
}, { _id: true });

const stockReturnSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    returnNumber: { type: String, required: true },
    // Original SIV reference (optional — can return without SIV ref)
    sivId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StockIssueVoucher',
      default: null,
    },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: true,
    },
    returnDate: { type: Date, default: Date.now },
    lines: {
      type: [returnLineSchema],
      validate: [(v) => v.length > 0, 'Return must have at least one line'],
    },
    // Only 'good' condition items go back to stock
    // 'damaged' / 'unusable' are written off separately
    stockUpdated: { type: Boolean, default: false },
    postedAt: { type: Date, default: null },
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    remarks: { type: String, trim: true, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

stockReturnSchema.index({ tenantId: 1, returnNumber: 1 }, { unique: true });
stockReturnSchema.index({ tenantId: 1, sivId: 1 });

module.exports = mongoose.model('StockReturn', stockReturnSchema);
