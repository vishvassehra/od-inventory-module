const StockTransfer = require('./stockTransfer.model');
const StockLedger   = require('./stockLedger.model');
const Counter       = require('../purchase/counter.model');
const { LEDGER_TXN_TYPE } = require('../../config/constants');
const { AppError }  = require('../../middleware/errorHandler');
const mongoose      = require('mongoose');

const populateOptions = [
  { path: 'fromWarehouseId', select: 'name code' },
  { path: 'toWarehouseId',   select: 'name code' },
  { path: 'lines.itemId',    select: 'name itemCode' },
  { path: 'lines.uomId',     select: 'name code' },
  { path: 'createdBy',       select: 'name email' },
  { path: 'postedBy',        select: 'name' },
];

// ── GET /api/v1/stock/transfers ───────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, fromWarehouseId, toWarehouseId } = req.query;
    const filter = { tenantId: req.tenantId };
    if (status)           filter.status = status;
    if (fromWarehouseId)  filter.fromWarehouseId = fromWarehouseId;
    if (toWarehouseId)    filter.toWarehouseId = toWarehouseId;

    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      StockTransfer.find(filter)
        .populate(populateOptions)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      StockTransfer.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) { next(err); }
};

// ── GET /api/v1/stock/transfers/:id ──────────────────────────────────────────
exports.getOne = async (req, res, next) => {
  try {
    const doc = await StockTransfer
      .findOne({ _id: req.params.id, tenantId: req.tenantId })
      .populate(populateOptions)
      .lean();
    if (!doc) throw new AppError('Transfer not found.', 404);
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
};

// ── POST /api/v1/stock/transfers ──────────────────────────────────────────────
// Creates a draft transfer and optionally posts it immediately.
exports.create = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { fromWarehouseId, toWarehouseId, lines, remarks, postNow = false } = req.body;

    if (!fromWarehouseId || !toWarehouseId)
      throw new AppError('Both source and destination warehouses are required.', 400);
    if (String(fromWarehouseId) === String(toWarehouseId))
      throw new AppError('Source and destination warehouse must be different.', 400);
    if (!lines || !lines.length)
      throw new AppError('At least one line item is required.', 400);

    const validLines = lines.filter(l => l.itemId && l.qty > 0);
    if (!validLines.length)
      throw new AppError('At least one line with positive qty is required.', 400);

    const fy   = Counter.currentFY();
    const tNum = await Counter.next(req.tenantId, 'STR', fy);

    const [transfer] = await StockTransfer.create([{
      tenantId: req.tenantId,
      transferNumber: tNum,
      fromWarehouseId,
      toWarehouseId,
      lines: validLines,
      remarks,
      status: 'draft',
      createdBy: req.user._id,
    }], { session });

    if (postNow) {
      // Validate stock availability
      for (const line of validLines) {
        const available = await StockLedger.getCurrentStock(req.tenantId, line.itemId, fromWarehouseId);
        if (available < line.qty) {
          const item = await require('../masters/item.model').findById(line.itemId).select('name itemCode').lean();
          throw new AppError(
            `Insufficient stock for ${item?.name || line.itemId}: available ${available}, requested ${line.qty}.`, 400
          );
        }
      }

      // Post ledger entries
      const txnDate = new Date();
      const ledgerDocs = [];
      for (const line of validLines) {
        ledgerDocs.push(
          { tenantId: req.tenantId, itemId: line.itemId, warehouseId: fromWarehouseId,
            txnType: LEDGER_TXN_TYPE.TRANSFER_OUT, qty: -line.qty, uomId: line.uomId,
            refDocType: 'STR', refDocId: transfer._id, refDocNo: tNum,
            remarks: line.remarks || remarks, createdBy: req.user._id, txnDate },
          { tenantId: req.tenantId, itemId: line.itemId, warehouseId: toWarehouseId,
            txnType: LEDGER_TXN_TYPE.TRANSFER_IN,  qty:  line.qty, uomId: line.uomId,
            refDocType: 'STR', refDocId: transfer._id, refDocNo: tNum,
            remarks: line.remarks || remarks, createdBy: req.user._id, txnDate },
        );
      }
      await StockLedger.insertMany(ledgerDocs, { session });

      transfer.status   = 'posted';
      transfer.postedAt = txnDate;
      transfer.postedBy = req.user._id;
      await transfer.save({ session });
    }

    await session.commitTransaction();
    await transfer.populate(populateOptions);

    res.status(201).json({ success: true, data: transfer });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};

// ── POST /api/v1/stock/transfers/:id/post ─────────────────────────────────────
exports.post = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const transfer = await StockTransfer
      .findOne({ _id: req.params.id, tenantId: req.tenantId })
      .session(session);
    if (!transfer) throw new AppError('Transfer not found.', 404);
    if (transfer.status === 'posted') throw new AppError('Transfer is already posted.', 400);

    for (const line of transfer.lines) {
      const available = await StockLedger.getCurrentStock(req.tenantId, line.itemId, transfer.fromWarehouseId);
      if (available < line.qty) {
        const item = await require('../masters/item.model').findById(line.itemId).select('name itemCode').lean();
        throw new AppError(
          `Insufficient stock for ${item?.name || line.itemId}: available ${available}, requested ${line.qty}.`, 400
        );
      }
    }

    const txnDate   = new Date();
    const ledgerDocs = [];
    for (const line of transfer.lines) {
      ledgerDocs.push(
        { tenantId: req.tenantId, itemId: line.itemId, warehouseId: transfer.fromWarehouseId,
          txnType: LEDGER_TXN_TYPE.TRANSFER_OUT, qty: -line.qty, uomId: line.uomId,
          refDocType: 'STR', refDocId: transfer._id, refDocNo: transfer.transferNumber,
          remarks: line.remarks || transfer.remarks, createdBy: req.user._id, txnDate },
        { tenantId: req.tenantId, itemId: line.itemId, warehouseId: transfer.toWarehouseId,
          txnType: LEDGER_TXN_TYPE.TRANSFER_IN,  qty:  line.qty, uomId: line.uomId,
          refDocType: 'STR', refDocId: transfer._id, refDocNo: transfer.transferNumber,
          remarks: line.remarks || transfer.remarks, createdBy: req.user._id, txnDate },
      );
    }
    await StockLedger.insertMany(ledgerDocs, { session });

    transfer.status   = 'posted';
    transfer.postedAt = txnDate;
    transfer.postedBy = req.user._id;
    await transfer.save({ session });

    await session.commitTransaction();
    await transfer.populate(populateOptions);
    res.json({ success: true, data: transfer });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};
