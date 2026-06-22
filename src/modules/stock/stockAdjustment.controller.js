const StockAdjustment = require('./stockAdjustment.model');
const StockLedger    = require('./stockLedger.model');
const Counter        = require('../purchase/counter.model');
const { LEDGER_TXN_TYPE } = require('../../config/constants');
const { AppError }   = require('../../middleware/errorHandler');
const mongoose       = require('mongoose');

const populateOptions = [
  { path: 'lines.itemId',      select: 'name itemCode' },
  { path: 'lines.uomId',       select: 'name code' },
  { path: 'lines.warehouseId', select: 'name code' },
  { path: 'createdBy',         select: 'name email' },
];

// ── GET /api/v1/stock/adjustments ─────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const filter = { tenantId: req.tenantId };
    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      StockAdjustment.find(filter)
        .populate(populateOptions)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      StockAdjustment.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) { next(err); }
};

// ── GET /api/v1/stock/adjustments/:id ────────────────────────────────────────
exports.getOne = async (req, res, next) => {
  try {
    const doc = await StockAdjustment
      .findOne({ _id: req.params.id, tenantId: req.tenantId })
      .populate(populateOptions)
      .lean();
    if (!doc) throw new AppError('Adjustment not found.', 404);
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
};

// ── POST /api/v1/stock/adjustments ───────────────────────────────────────────
// Creates and immediately posts the adjustment.
exports.create = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { lines, reason, remarks } = req.body;

    if (!reason) throw new AppError('Reason is required for stock adjustment.', 400);
    if (!lines || !lines.length) throw new AppError('At least one line item is required.', 400);

    const validLines = lines.filter(l => l.itemId && l.warehouseId && l.qty > 0 && l.adjType);
    if (!validLines.length) throw new AppError('No valid adjustment lines provided.', 400);

    // For sub-adjustments, validate available stock
    for (const line of validLines.filter(l => l.adjType === 'sub')) {
      const available = await StockLedger.getCurrentStock(req.tenantId, line.itemId, line.warehouseId);
      if (available < line.qty) {
        const item = await require('../masters/item.model').findById(line.itemId).select('name itemCode').lean();
        throw new AppError(
          `Cannot write-off ${line.qty} of ${item?.name || line.itemId}: only ${available} available.`, 400
        );
      }
    }

    const fy   = Counter.currentFY();
    const aNum = await Counter.next(req.tenantId, 'ADJ', fy);

    const [adjustment] = await StockAdjustment.create([{
      tenantId: req.tenantId,
      adjustmentNumber: aNum,
      reason,
      remarks,
      lines: validLines,
      createdBy: req.user._id,
      postedAt: new Date(),
    }], { session });

    // Write ledger entries
    const txnDate = new Date();
    const ledgerDocs = validLines.map(line => ({
      tenantId:    req.tenantId,
      itemId:      line.itemId,
      warehouseId: line.warehouseId,
      txnType:     line.adjType === 'add' ? LEDGER_TXN_TYPE.ADJUSTMENT_ADD : LEDGER_TXN_TYPE.ADJUSTMENT_SUB,
      qty:         line.adjType === 'add' ? line.qty : -line.qty,
      refDocType:  'ADJ',
      refDocId:    adjustment._id,
      refDocNo:    aNum,
      remarks:     line.remarks || reason,
      createdBy:   req.user._id,
      txnDate,
    }));

    await StockLedger.insertMany(ledgerDocs, { session });
    await session.commitTransaction();

    await adjustment.populate(populateOptions);
    res.status(201).json({ success: true, data: adjustment });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};
