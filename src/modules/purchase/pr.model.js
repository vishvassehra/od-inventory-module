const mongoose = require('mongoose');
const { APPROVAL_STATUS } = require('../../config/constants');

const prLineSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  description: { type: String, trim: true }, // free-text override or new item note
  uomId: { type: mongoose.Schema.Types.ObjectId, ref: 'UOM', required: true },
  requiredQty: { type: Number, required: true, min: [0.01, 'Quantity must be greater than 0'] },
  estimatedRate: { type: Number, default: null },
  purpose: { type: String, trim: true }, // per-line purpose note
  // Tracking how much of this line got converted to PO
  poQty: { type: Number, default: 0 },
}, { _id: true });

const purchaseRequisitionSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    prNumber: { type: String, required: true },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: [true, 'Department is required'],
    },
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: [true, 'Warehouse is required'],
    },
    requiredByDate: { type: Date, default: null },
    purpose: { type: String, trim: true }, // overall PR purpose
    priority: {
      type: String,
      enum: ['low', 'normal', 'urgent'],
      default: 'normal',
    },
    lines: {
      type: [prLineSchema],
      validate: [(v) => v.length > 0, 'PR must have at least one line item'],
    },
    status: {
      type: String,
      enum: Object.values(APPROVAL_STATUS),
      default: APPROVAL_STATUS.DRAFT,
    },
    // Approval chain
    submittedAt: { type: Date, default: null },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    hodApprovedAt: { type: Date, default: null },
    hodApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    hodRejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    // For high-value PRs — inst admin second approval
    adminApprovedAt: { type: Date, default: null },
    adminApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    remarks: { type: String, trim: true, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

purchaseRequisitionSchema.index({ tenantId: 1, prNumber: 1 }, { unique: true });
purchaseRequisitionSchema.index({ tenantId: 1, status: 1 });
purchaseRequisitionSchema.index({ tenantId: 1, departmentId: 1 });

module.exports = mongoose.model('PurchaseRequisition', purchaseRequisitionSchema);
