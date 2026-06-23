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
    tenantId:    { type: String, required: true, index: true },
    referenceNo: { type: String, required: true },
    fy:          { type: String, required: true },  // e.g. "26-27" — one OSE per FY per tenant
    asOfDate:    { type: Date,   required: true },
    lines: {
      type: [openingStockLineSchema],
      validate: [(v) => v.length > 0, 'Opening stock must have at least one line'],
    },
    isPosted:  { type: Boolean, default: false },
    postedAt:  { type: Date,    default: null },
    postedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    remarks:   { type: String,  trim: true, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// Hard constraint: only one OSE per FY per tenant
openingStockSchema.index({ tenantId: 1, fy: 1 }, { unique: true });
openingStockSchema.index({ tenantId: 1, referenceNo: 1 }, { unique: true });

module.exports = mongoose.model('OpeningStock', openingStockSchema);
