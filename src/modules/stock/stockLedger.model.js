const mongoose = require('mongoose');
const { LEDGER_TXN_TYPE } = require('../../config/constants');

/**
 * APPEND-ONLY stock ledger.
 * Never update or delete entries.
 * Current stock = sum of all qty entries for a given item + warehouse.
 *
 * Positive qty = stock IN  (GRN, return, transfer_in, adj_add, opening)
 * Negative qty = stock OUT (issue, transfer_out, adj_sub)
 */
const stockLedgerSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
    warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    txnType: {
      type: String,
      enum: Object.values(LEDGER_TXN_TYPE),
      required: true,
    },
    // Positive = IN, Negative = OUT
    qty: { type: Number, required: true },
    // Unit rate at time of transaction (for valuation)
    unitRate: { type: Number, default: 0 },
    // Reference document
    refDocType: { type: String, default: null },  // 'GRN', 'SIV', 'STR', etc.
    refDocId: { type: mongoose.Schema.Types.ObjectId, default: null },
    refDocNo: { type: String, default: null },    // human-readable doc number
    // Department context (for issue/return)
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    remarks: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // txnDate allows backdating (e.g. opening stock) — defaults to now
    txnDate: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    // Prevent accidental updates — ledger is immutable
  }
);

// Indexes for common queries
stockLedgerSchema.index({ tenantId: 1, itemId: 1, warehouseId: 1 });
stockLedgerSchema.index({ tenantId: 1, txnType: 1 });
stockLedgerSchema.index({ tenantId: 1, refDocId: 1 });
stockLedgerSchema.index({ tenantId: 1, txnDate: -1 });

/**
 * Get current stock for an item in a warehouse (or across all warehouses).
 * Returns aggregated qty sum.
 */
stockLedgerSchema.statics.getCurrentStock = async function (tenantId, itemId, warehouseId = null) {
  const match = { tenantId, itemId: new (require('mongoose').Types.ObjectId)(itemId) };
  if (warehouseId) match.warehouseId = new (require('mongoose').Types.ObjectId)(warehouseId);

  const result = await this.aggregate([
    { $match: match },
    { $group: { _id: '$warehouseId', stock: { $sum: '$qty' } } },
  ]);

  if (warehouseId) return result[0]?.stock || 0;
  return result; // array of { _id: warehouseId, stock }
};

/**
 * Get stock summary for all items in a warehouse.
 */
stockLedgerSchema.statics.getStockSummary = async function (tenantId, warehouseId = null) {
  const match = { tenantId };
  if (warehouseId) match.warehouseId = new (require('mongoose').Types.ObjectId)(warehouseId);

  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: { itemId: '$itemId', warehouseId: '$warehouseId' },
        stock: { $sum: '$qty' },
      },
    },
    {
      $lookup: {
        from: 'items',
        localField: '_id.itemId',
        foreignField: '_id',
        as: 'item',
      },
    },
    { $unwind: '$item' },
    {
      $project: {
        _id: 0,
        itemId: '$_id.itemId',
        warehouseId: '$_id.warehouseId',
        itemCode: '$item.itemCode',
        itemName: '$item.name',
        stock: 1,
        reorderQty: '$item.reorderQty',
        minStock: '$item.minStock',
        isBelowReorder: { $lte: ['$stock', '$item.reorderQty'] },
      },
    },
    { $sort: { itemName: 1 } },
  ]);
};

module.exports = mongoose.model('StockLedger', stockLedgerSchema);
