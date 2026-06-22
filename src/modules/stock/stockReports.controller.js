const StockLedger = require('./stockLedger.model');
const Item = require('../masters/item.model');
const { AppError } = require('../../middleware/errorHandler');
const mongoose = require('mongoose');

// ── GET /api/v1/stock/summary ─────────────────────────────────────────────────
// Current stock per item per warehouse
exports.stockSummary = async (req, res, next) => {
  try {
    const { warehouseId, categoryId, belowReorder } = req.query;

    const matchStage = { tenantId: req.tenantId };
    if (warehouseId) matchStage.warehouseId = new mongoose.Types.ObjectId(warehouseId);

    const summary = await StockLedger.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { itemId: '$itemId', warehouseId: '$warehouseId' },
          stock: { $sum: '$qty' },
          lastTxnDate: { $max: '$txnDate' },
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
        $lookup: {
          from: 'warehouses',
          localField: '_id.warehouseId',
          foreignField: '_id',
          as: 'warehouse',
        },
      },
      { $unwind: { path: '$warehouse', preserveNullAndEmptyArrays:: true } },
      {
        $lookup: {
          from: 'categories',
          localField: 'item.categoryId',
          foreignField: '_id',
          as: 'category',
        },
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays:: true } },
      // Filter by category if provided
      ...(categoryId ? [{ $match: { 'item.categoryId': new mongoose.Types.ObjectId(categoryId) } }] : []),
      {
        $project: {
          _id: 0,
          itemId: '$_id.itemId',
          warehouseId: '$_id.warehouseId',
          itemCode: '$item.itemCode',
          itemName: '$item.name',
          categoryName: '$category.name',
          warehouseName: '$warehouse.name',
          warehouseCode: '$warehouse.code',
          stock: 1,
          reorderQty: '$item.reorderQty',
          minStock: '$item.minStock',
          lastPurchaseRate: '$item.lastPurchaseRate',
          stockValue: { $multiply: ['$stock', { $ifNull: ['$item.lastPurchaseRate', 0] }] },
          isBelowReorder: { $lte: ['$stock', '$item.reorderQty'] },
          isBelowMin: { $lte: ['$stock', '$item.minStock'] },
          lastTxnDate: 1,
        },
      },
      // Filter below reorder if requested
      ...(belowReorder === 'true' ? [{ $match: { isBelowReorder: true } }] : []),
      { $sort: { itemName: 1 } },
    ]);

    const totalValue = summary.reduce((sum, s) => sum + (s.stockValue || 0), 0);

    res.json({
      success: true,
      data: summary,
      meta: {
        totalItems: summary.length,
        totalStockValue: +totalValue.toFixed(2),
        belowReorderCount: summary.filter(s => s.isBelowReorder).length,
      },
    });
  } catch (err) { next(err); }
};

// ── GET /api/v1/stock/ledger ──────────────────────────────────────────────────
// Full movement register with running balance
exports.stockLedger = async (req, res, next) => {
  try {
    const { itemId, warehouseId, fromDate, toDate, txnType, page = 1, limit = 50 } = req.query;

    if (!itemId) throw new AppError('itemId is required for ledger report.', 400);

    const match = { tenantId: req.tenantId, itemId: new mongoose.Types.ObjectId(itemId) };
    if (warehouseId) match.warehouseId = new mongoose.Types.ObjectId(warehouseId);
    if (txnType) match.txnType = txnType;
    if (fromDate || toDate) {
      match.txnDate = {};
      if (fromDate) match.txnDate.$gte = new Date(fromDate);
      if (toDate) { const end = new Date(toDate); end.setHours(23, 59, 59, 999); match.txnDate.$lte = end; }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [entries, total] = await Promise.all([
      StockLedger.find(match)
        .populate([
          { path: 'itemId', select: 'name itemCode uomId' },
          { path: 'warehouseId', select: 'name code' },
          { path: 'departmentId', select: 'name code' },
          { path: 'createdBy', select: 'name' },
        ])
        .sort({ txnDate: 1, createdAt: 1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      StockLedger.countDocuments(match),
    ]);

    // Compute running balance
    let runningBalance = 0;
    const ledgerWithBalance = entries.map(e => {
      runningBalance += e.qty;
      return { ...e, runningBalance: +runningBalance.toFixed(4) };
    });

    res.json({
      success: true,
      data: ledgerWithBalance,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) { next(err); }
};

// ── GET /api/v1/stock/low-stock ───────────────────────────────────────────────
exports.lowStock = async (req, res, next) => {
  try {
    const { warehouseId } = req.query;
    const matchStage = { tenantId: req.tenantId };
    if (warehouseId) matchStage.warehouseId = new mongoose.Types.ObjectId(warehouseId);

    const result = await StockLedger.aggregate([
      { $match: matchStage },
      { $group: { _id: { itemId: '$itemId', warehouseId: '$warehouseId' }, stock: { $sum: '$qty' } } },
      { $lookup: { from: 'items', localField: '_id.itemId', foreignField: '_id', as: 'item' } },
      { $unwind: '$item' },
      { $match: { $expr: { $lte: ['$stock', '$item.reorderQty'] }, 'item.isActive': true } },
      { $lookup: { from: 'warehouses', localField: '_id.warehouseId', foreignField: '_id', as: 'warehouse' } },
      { $unwind: { path: '$warehouse', preserveNullAndEmptyArrays:: true } },
      {
        $project: {
          _id: 0,
          itemId: '$_id.itemId',
          itemCode: '$item.itemCode',
          itemName: '$item.name',
          warehouseName: '$warehouse.name',
          currentStock: '$stock',
          reorderQty: '$item.reorderQty',
          minStock: '$item.minStock',
          shortage: { $subtract: ['$item.reorderQty', '$stock'] },
        },
      },
      { $sort: { shortage: -1 } },
    ]);

    res.json({ success: true, data: result, meta: { count: result.length } });
  } catch (err) { next(err); }
};

// ── GET /api/v1/stock/item-stock/:itemId ──────────────────────────────────────
// Quick stock check for a specific item across all warehouses
exports.itemStock = async (req, res, next) => {
  try {
    const { itemId } = req.params;
    const result = await StockLedger.getCurrentStock(req.tenantId, itemId);
    const item = await Item.findById(itemId).select('name itemCode reorderQty minStock').lean();
    if (!item) throw new AppError('Item not found.', 404);
    res.json({ success: true, data: { item, stockByWarehouse: result } });
  } catch (err) { next(err); }
};
