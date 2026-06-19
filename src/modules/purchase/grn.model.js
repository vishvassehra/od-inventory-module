const mongoose = require('mongoose');
const { GRN_STATUS } = require('../../config/constants');

const grnLineSchema = new mongoose.Schema({
  poLineId: { type: mongoose.Schema.Types.ObjectId, default: null },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  uomId: { type: mongoose.Schema.Types.ObjectId, ref: 'UOM', required: true },
  orderedQty: { type: Number, default: 0 },   // from PO line
  receivedQty: { type: Number, required: true, min: [0.01, 'Received qty must be > 0'] },
  acceptedQty: { type: Number, required: true, min: 0 }, // after quality check
  rejectedQty: { type: Number, default: 0 },
  unitRate: { type: Number, required: true, min: 0 },
  taxPercent: { type: Number, default: 0 },
  lineTotal: { type: Number, default: 0 },    // acceptedQty * unitRate
  qcRemarks: { type: String, trim: true, default: null },
  // For asset items — serial numbers captured at GRN
  serialNumbers: [{ type: String, trim: true }],
  // Flag — asset records will be created from these lines after GRN is posted
  assetRecordsCreated: { type: Boolean, default: false },
}, { _id: true });

const grnSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    grnNumber: { type: String, required: true },
    poId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseOrder',
      required: [true, 'PO reference is required'],
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
    },
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: [true, 'Warehouse is required'],
    },
    // Vendor document details
    vendorInvoiceNo: { type: String, trim: true, default: null },
    vendorInvoiceDate: { type: Date, default: null },
    vehicleNo: { type: String, trim: true, default: null },
    dcNo: { type: String, trim: true, default: null }, // Delivery Challan number
    lines: {
      type: [grnLineSchema],
      validate: [(v) => v.length > 0, 'GRN must have at least one line'],
    },
    // Totals
    grandTotal: { type: Number, default: 0 },
    status: {
      type: String,
      enum: Object.values(GRN_STATUS),
      default: GRN_STATUS.DRAFT,
    },
    isPartial: { type: Boolean, default: false }, // true if PO still has pending qty
    postedAt: { type: Date, default: null },       // when stock ledger was updated
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    remarks: { type: String, trim: true, default: null },
    // Rate variance flag — set if any line rate deviates > 5% from PO rate
    hasRateVariance: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

grnSchema.pre('save', function () {
  this.grandTotal = +this.lines
    .reduce((sum, l) => sum + (l.acceptedQty * l.unitRate), 0)
    .toFixed(2);
});

grnSchema.index({ tenantId: 1, grnNumber: 1 }, { unique: true });
grnSchema.index({ tenantId: 1, poId: 1 });
grnSchema.index({ tenantId: 1, status: 1 });

module.exports = mongoose.model('GRN', grnSchema);
