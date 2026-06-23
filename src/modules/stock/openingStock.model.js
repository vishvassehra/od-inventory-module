const mongoose = require('mongoose');

const openingStockLineSchema = new mongoose.Schema({
  itemId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Item',      required: true },
  uomId:       { type: mongoose.Schema.Types.ObjectId, ref: 'UOM',       required: true },
  warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  qty:         { type: Number, required: true, min: [0.01, 'Qty must be greater than zero'] },
  unitRate:    { type: Number, default: 0, min: 0 },
}, { _id: true });

const openingStockSchema = new mongoose.Schema(
  {
    tenantId:     { type: String,   required: true },
    referenceNo:  { type: String,   required: true },
    // fy is display-only, derived from asOfDate — NOT used for locking
    fy:           { type: String,   required: true },
    asOfDate:     { type: Date,     required: true },
    // No min-length — OSE document can exist with zero lines (lines added incrementally)
    lines:        { type: [openingStockLineSchema], default: [] },
    remarks:      { type: String,   trim: true, default: null },
    createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lastEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lastEditedAt: { type: Date,     default: null },
  },
  { timestamps: true }
);

// ONE OSE per tenant — not per FY
openingStockSchema.index({ tenantId: 1 }, { unique: true });
openingStockSchema.index({ tenantId: 1, referenceNo: 1 }, { unique: true });

module.exports = mongoose.model('OpeningStock', openingStockSchema);
