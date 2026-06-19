const StockReturn = require('./stockReturn.model');
const StockLedger = require('./stockLedger.model');
const Counter = require('../purchase/counter.model');
const { LEDGER_TXN_TYPE } = require('../../config/constants');
const { AppError } = require('../../middleware/errorHandler');
const mongoose = require('mongoose');

const populateOptions = [
  { path: 'departmentId', select: 'name code' },
  { path: 'sivId', select: 'sivNumber' },
  { path: 'lines.itemId', select: 'name itemCode' },
  { path: 'lines.uomId', select: 'name code' },
  { path: 'lines.warehouseId', select: 'name code' },
  { path: 'createdBy', select: 'name email' },
  { path: 'postedBy', select: 'name' },
];

// ── GET /api/v1/stock/returns ─────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, departmentId } = req.query;
    const filter = { tenantId: req.tenantId };
    if (departmentId) filter.departmentId = departmentId;
    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      StockReturn.find(filter).populate(populateOptions).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      StockReturn.countDocuments(filter),
    ]);
    res.json({ success: true, data, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) } });
  } catch (err) { next(err); }
};

// ── GET /api/v1/stock/returns/:id ─────────────────────────────────────────────
exports.getOne = async (req, res, next) => {
  try {
    const ret = await StockReturn.findOne({ _id: req.params.id, tenantId: req.tenantId }).populate(populateOptions).lean();
    if (!ret) throw new AppError('Stock return not found.', 404);
    res.json({ success: true, data: ret });
  } catch (err) { next(err); }
};

// ── POST /api/v1/stock/returns ────────────────────────────────────────────────
// Creates AND posts the return in one step (returns don't need approval)
exports.create = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { departmentId, sivId, lines, remarks, returnDate } = req.body;

    if (!departmentId) throw new AppError('Department is required.', 400);
    if (!lines || !lines.length) throw new AppError('At least one line item is required.', 400);

    const fy = Counter.currentFY();
    const returnNumber = await Counter.next(req.tenantId, 'STR', fy);

    const stockReturn = await StockReturn.create([{
      tenantId: req.tenantId,
      returnNumber,
      sivId: sivId || null,
      departmentId,
      returnDate: returnDate || new Date(),
      lines,
      remarks,
      createdBy: req.user._id,
    }], { session });

    // Post ledger entries for 'good' condition items only
    const ledgerEntries = lines
      .filter(l => l.condition !== 'unusable' && l.returnQty > 0)
      .map(l => ({
        tenantId: req.tenantId,
        itemId: l.itemId,
        warehouseId: l.warehouseId,
        txnType: LEDGER_TXN_TYPE.RETURN,
        qty: +l.returnQty,   // POSITIVE — stock coming back in
        unitRate: l.unitRate || 0,
        refDocType: 'STR',
        refDocId: stockReturn[0]._id,
        refDocNo: returnNumber,
        departmentId,
        remarks: l.remarks,
        createdBy: req.user._id,
        txnDate: new Date(),
      }));

    if (ledgerEntries.length) {
      await StockLedger.insertMany(ledgerEntries, { session });
    }

    // Mark as posted
    await StockReturn.findByIdAndUpdate(
      stockReturn[0]._id,
      { stockUpdated: true, postedAt: new Date(), postedBy: req.user._id },
      { session }
    );

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: `Return ${returnNumber} posted. Stock updated for ${ledgerEntries.length} item(s).`,
      data: { returnNumber, itemsReturned: ledgerEntries.length },
    });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};
