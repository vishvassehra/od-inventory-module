const mongoose = require('mongoose');
const { APPROVAL_STATUS } = require('../../config/constants');

const sivLineSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  uomId: { type: mongoose.Schema.Types.ObjectId, ref: 'UOM', required: true },
  warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  requestedQty: { type: Number, required: true, min: [0.01, 'Qty must be > 0'] },
  issuedQty: { type: Number, default: 0 },     // filled by store manager on issue
  availableQty: { type: Number, default: 0 },  // snapshot at time of issue
  unitRate: { type: Number, default: 0 },       // last purchase rate at issue time
  remarks: { type: String, trim: true, default: null },
}, { _id: true });

const stockIssueVoucherSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    sivNumber: { type: String, required: true },
    // Indent raised by dept staff / HOD
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
    purpose: { type: String, trim: true, default: null },
    lines: {
      type: [sivLineSchema],
      validate: [(v) => v.length > 0, 'SIV must have at least one line'],
    },
    status: {
      type: String,
      enum: Object.values(APPROVAL_STATUS),
      default: APPROVAL_STATUS.DRAFT,
    },
    // Approval
    submittedAt: { type: Date, default: null },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    hodApprovedAt: { type: Date, default: null },
    hodApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectionReason: { type: String, default: null },
    // Issue
    issuedAt: { type: Date, default: null },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    receivedBy: { type: String, trim: true, default: null }, // receiver name (sign-off)
    remarks: { type: String, trim: true, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

stockIssueVoucherSchema.index({ tenantId: 1, sivNumber: 1 }, { unique: true });
stockIssueVoucherSchema.index({ tenantId: 1, status: 1 });
stockIssueVoucherSchema.index({ tenantId: 1, departmentId: 1 });

module.exports = mongoose.model('StockIssueVoucher', stockIssueVoucherSchema);
