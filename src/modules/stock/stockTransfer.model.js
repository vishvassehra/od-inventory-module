const mongoose = require('mongoose');

const transferLineSchema = new mongoose.Schema({
  itemId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  uomId:   { type: mongoose.Schema.Types.ObjectId, ref: 'UOM' },
  qty:     { type: Number, required: true, min: 0.01 },
  remarks: { type: String },
}, { _id: false });

const stockTransferSchema = new mongoose.Schema({
  tenantId:        { type: String, required: true, index: true },
  transferNumber:  { type: String, required: true },
  fromWarehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  toWarehouseId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  lines:           { type: [transferLineSchema], required: true },
  remarks:         { type: String },
  status:          { type: String, enum: ['draft', 'posted'], default: 'draft' },
  postedAt:        { type: Date },
  postedBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

stockTransferSchema.index({ tenantId: 1, createdAt: -1 });
stockTransferSchema.index({ tenantId: 1, transferNumber: 1 }, { unique: true });

module.exports = mongoose.model('StockTransfer', stockTransferSchema);
