const mongoose = require('mongoose');
const { APPROVAL_STATUS, PO_STATUS } = require('../../config/constants');

const poLineSchema = new mongoose.Schema({
  prId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequisition', default: null },
  prLineId: { type: mongoose.Schema.Types.ObjectId, default: null }, // ref to PR line _id
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  description: { type: String, trim: true },
  uomId: { type: mongoose.Schema.Types.ObjectId, ref: 'UOM', required: true },
  orderedQty: { type: Number, required: true, min: [0.01, 'Quantity must be > 0'] },
  unitRate: { type: Number, required: true, min: [0, 'Rate cannot be negative'] },
  taxPercent: { type: Number, default: 0, min: 0, max: 100 }, // GST %
  taxAmount: { type: Number, default: 0 },
  lineTotal: { type: Number, default: 0 }, // orderedQty * unitRate + taxAmount
  // Tracking GRN receipt
  receivedQty: { type: Number, default: 0 },
}, { _id: true });

// Auto-compute line totals before save
poLineSchema.pre('save', function () {
  const base = this.orderedQty * this.unitRate;
  this.taxAmount = +(base * (this.taxPercent / 100)).toFixed(2);
  this.lineTotal = +(base + this.taxAmount).toFixed(2);
});

const purchaseOrderSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    poNumber: { type: String, required: true },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: [true, 'Vendor is required'],
    },
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: [true, 'Warehouse is required'],
    },
    // PR references — a PO can consolidate multiple PRs
    prIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequisition' }],
    deliveryDate: { type: Date, default: null },
    deliveryAddress: { type: String, trim: true, default: null },
    paymentTerms: { type: String, trim: true, default: null }, // e.g. "Net 30"
    lines: {
      type: [poLineSchema],
      validate: [(v) => v.length > 0, 'PO must have at least one line item'],
    },
    // Totals (computed on save)
    subTotal: { type: Number, default: 0 },
    totalTax: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
    status: {
      type: String,
      enum: Object.values(PO_STATUS),
      default: PO_STATUS.DRAFT,
    },
    // Approval
    approvalStatus: {
      type: String,
      enum: Object.values(APPROVAL_STATUS),
      default: APPROVAL_STATUS.DRAFT,
    },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    sentToVendorAt: { type: Date, default: null },
    // Amendment tracking
    amendmentNo: { type: Number, default: 0 },
    amendmentLog: [{
      amendedAt: Date,
      amendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      changes: String,
    }],
    remarks: { type: String, trim: true, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// Auto-compute order totals
purchaseOrderSchema.pre('save', function () {
  this.subTotal = +this.lines.reduce((sum, l) => sum + (l.orderedQty * l.unitRate), 0).toFixed(2);
  this.totalTax = +this.lines.reduce((sum, l) => sum + (l.taxAmount || 0), 0).toFixed(2);
  this.grandTotal = +(this.subTotal + this.totalTax).toFixed(2);
});

purchaseOrderSchema.index({ tenantId: 1, poNumber: 1 }, { unique: true });
purchaseOrderSchema.index({ tenantId: 1, status: 1 });
purchaseOrderSchema.index({ tenantId: 1, vendorId: 1 });

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
