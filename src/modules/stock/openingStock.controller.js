const OpeningStock = require('./openingStock.model');
const StockLedger = require('./stockLedger.model');
const Counter = require('../purchase/counter.model');
const { LEDGER_TXN_TYPE, ROLES } = require('../../config/constants');
const { AppError } = require('../../middleware/errorHandler');
const mongoose = require('mongoose');

// ── GET /api/v1/stock/opening ─────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const data = await OpeningStock.find({ tenantId: req.tenantId })
      .populate([
        { path: 'lines.itemId', select: 'name itemCode' },
        { path: 'lines.warehouseId', select: 'name code' },
        { path: 'createdBy', select: 'name' },
      ])
      .sort({ createdAt: -1 }).lean();
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

// ── POST /api/v1/stock/opening ────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { lines, asOfDate, remarks } = req.body;
    if (!lines || !lines.length) throw new AppError('At least one line is required.', 400);
    if (!asOfDate) throw new AppError('As-of date is required.', 400);

    // Prevent duplicate opening stock for same items (warn but allow)
    const fy = Counter.currentFY();
    const referenceNo = await Counter.next(req.tenantId, 'OSE', fy);

    const entry = await OpeningStock.create([{
      tenantId: req.tenantId,
      referenceNo,
      asOfDate: new Date(asOfDate),
      lines,
      remarks,
      createdBy: req.user._id,
    }], { session });

    // Post ledger entries immediately
    const ledgerEntries = lines.map(l => ({
      tenantId: req.tenantId,
      itemId: l.itemId,
      warehouseId: l.warehouseId,
      txnType: LEDGER_TXN_TYPE.OPENING,
      qty: +l.qty,
      unitRate: l.unitRate || 0,
      refDocType: 'OSE',
      refDocId: entry[0]._id,
      refDocNo: referenceNo,
      remarks: 'Opening stock entry',
      createdBy: req.user._id,
      txnDate: new Date(asOfDate),
    }));

    await StockLedger.insertMany(ledgerEntries, { session });

    await OpeningStock.findByIdAndUpdate(
      entry[0]._id,
      { isPosted: true, postedAt: new Date(), postedBy: req.user._id },
      { session }
    );

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: `Opening stock ${referenceNo} posted for ${lines.length} item(s).`,
      data: { referenceNo, itemCount: lines.length },
    });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};
