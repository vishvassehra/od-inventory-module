const StockIssueVoucher = require('./siv.model');
const StockLedger = require('./stockLedger.model');
const Item = require('../masters/item.model');
const Counter = require('../purchase/counter.model');
const { APPROVAL_STATUS, ROLES, LEDGER_TXN_TYPE } = require('../../config/constants');
const { AppError } = require('../../middleware/errorHandler');
const mongoose = require('mongoose');

const populateOptions = [
  { path: 'departmentId', select: 'name code' },
  { path: 'warehouseId', select: 'name code' },
  { path: 'lines.itemId', select: 'name itemCode' },
  { path: 'lines.uomId', select: 'name code' },
  { path: 'lines.warehouseId', select: 'name code' },
  { path: 'createdBy', select: 'name email' },
  { path: 'submittedBy', select: 'name' },
  { path: 'hodApprovedBy', select: 'name' },
  { path: 'issuedBy', select: 'name' },
];

// ── GET /api/v1/stock/sivs ────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, departmentId } = req.query;
    const filter = { tenantId: req.tenantId };
    if (status) filter.status = status;
    if (departmentId) filter.departmentId = departmentId;

    // HOD sees only their dept
    if (req.user.role === ROLES.HOD) filter.departmentId = req.user.departmentId;
    // Dept staff sees only their own
    if (req.user.role === ROLES.DEPT_STAFF) filter.createdBy = req.user._id;

    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      StockIssueVoucher.find(filter).populate(populateOptions).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      StockIssueVoucher.countDocuments(filter),
    ]);
    res.json({ success: true, data, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) } });
  } catch (err) { next(err); }
};

// ── GET /api/v1/stock/sivs/:id ────────────────────────────────────────────────
exports.getOne = async (req, res, next) => {
  try {
    const siv = await StockIssueVoucher.findOne({ _id: req.params.id, tenantId: req.tenantId }).populate(populateOptions).lean();
    if (!siv) throw new AppError('SIV not found.', 404);
    res.json({ success: true, data: siv });
  } catch (err) { next(err); }
};

// ── POST /api/v1/stock/sivs ───────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const fy = Counter.currentFY();
    const sivNumber = await Counter.next(req.tenantId, 'SIV', fy);

    const siv = await StockIssueVoucher.create({
      ...req.body,
      tenantId: req.tenantId,
      sivNumber,
      status: APPROVAL_STATUS.DRAFT,
      createdBy: req.user._id,
    });

    const populated = await StockIssueVoucher.findById(siv._id).populate(populateOptions).lean();
    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
};

// ── PATCH /api/v1/stock/sivs/:id ─────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const siv = await StockIssueVoucher.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!siv) throw new AppError('SIV not found.', 404);
    if (siv.status !== APPROVAL_STATUS.DRAFT) throw new AppError('Only draft SIVs can be edited.', 400);
    const allowed = ['lines', 'departmentId', 'warehouseId', 'purpose', 'remarks'];
    allowed.forEach((k) => { if (req.body[k] !== undefined) siv[k] = req.body[k]; });
    await siv.save();
    const populated = await StockIssueVoucher.findById(siv._id).populate(populateOptions).lean();
    res.json({ success: true, data: populated });
  } catch (err) { next(err); }
};

// ── POST /api/v1/stock/sivs/:id/submit ───────────────────────────────────────
exports.submit = async (req, res, next) => {
  try {
    const siv = await StockIssueVoucher.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!siv) throw new AppError('SIV not found.', 404);
    if (siv.status !== APPROVAL_STATUS.DRAFT) throw new AppError('SIV is not in draft state.', 400);
    siv.status = APPROVAL_STATUS.PENDING;
    siv.submittedAt = new Date();
    siv.submittedBy = req.user._id;
    await siv.save();
    res.json({ success: true, message: 'SIV submitted for HOD approval.', data: { sivNumber: siv.sivNumber, status: siv.status } });
  } catch (err) { next(err); }
};

// ── POST /api/v1/stock/sivs/:id/approve ──────────────────────────────────────
exports.approve = async (req, res, next) => {
  try {
    const siv = await StockIssueVoucher.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!siv) throw new AppError('SIV not found.', 404);
    if (siv.status !== APPROVAL_STATUS.PENDING) throw new AppError('SIV is not pending approval.', 400);

    if (req.user.role === ROLES.HOD && String(siv.departmentId) !== String(req.user.departmentId)) {
      throw new AppError('You can only approve SIVs from your department.', 403);
    }

    siv.status = APPROVAL_STATUS.APPROVED;
    siv.hodApprovedAt = new Date();
    siv.hodApprovedBy = req.user._id;
    await siv.save();
    res.json({ success: true, message: 'SIV approved. Store manager can now issue stock.', data: { sivNumber: siv.sivNumber, status: siv.status } });
  } catch (err) { next(err); }
};

// ── POST /api/v1/stock/sivs/:id/reject ───────────────────────────────────────
exports.reject = async (req, res, next) => {
  try {
    if (!req.body.reason) throw new AppError('Rejection reason is required.', 400);
    const siv = await StockIssueVoucher.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!siv) throw new AppError('SIV not found.', 404);
    if (siv.status !== APPROVAL_STATUS.PENDING) throw new AppError('SIV is not pending approval.', 400);
    siv.status = APPROVAL_STATUS.REJECTED;
    siv.rejectionReason = req.body.reason;
    await siv.save();
    res.json({ success: true, message: 'SIV rejected.', data: { sivNumber: siv.sivNumber, status: siv.status } });
  } catch (err) { next(err); }
};

// ── POST /api/v1/stock/sivs/:id/issue ────────────────────────────────────────
// THE critical action — deducts stock from ledger
exports.issue = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const siv = await StockIssueVoucher.findOne({ _id: req.params.id, tenantId: req.tenantId }).session(session);
    if (!siv) throw new AppError('SIV not found.', 404);
    if (siv.status !== APPROVAL_STATUS.APPROVED) throw new AppError('SIV must be approved before issuing.', 400);

    const { issuedLines, receivedBy } = req.body;
    if (!issuedLines || !issuedLines.length) throw new AppError('Issued quantities are required.', 400);

    const ledgerEntries = [];

    for (const issuedLine of issuedLines) {
      const sivLine = siv.lines.id(issuedLine.lineId);
      if (!sivLine) continue;

      const issuedQty = Number(issuedLine.issuedQty) || 0;
      if (issuedQty <= 0) continue;

      // Check available stock
      const availableStock = await StockLedger.getCurrentStock(req.tenantId, sivLine.itemId, sivLine.warehouseId);
      if (availableStock < issuedQty) {
        throw new AppError(
          `Insufficient stock for item. Available: ${availableStock}, Requested: ${issuedQty}`,
          400
        );
      }

      // Get last purchase rate for valuation
      const item = await Item.findById(sivLine.itemId).select('lastPurchaseRate').lean();

      // Update SIV line
      sivLine.issuedQty = issuedQty;
      sivLine.availableQty = availableStock;
      sivLine.unitRate = item?.lastPurchaseRate || 0;

      // Build ledger entry (negative qty = stock OUT)
      ledgerEntries.push({
        tenantId: req.tenantId,
        itemId: sivLine.itemId,
        warehouseId: sivLine.warehouseId,
        txnType: LEDGER_TXN_TYPE.ISSUE,
        qty: -issuedQty,   // NEGATIVE — stock going out
        unitRate: item?.lastPurchaseRate || 0,
        refDocType: 'SIV',
        refDocId: siv._id,
        refDocNo: siv.sivNumber,
        departmentId: siv.departmentId,
        remarks: sivLine.remarks,
        createdBy: req.user._id,
        txnDate: new Date(),
      });
    }

    if (!ledgerEntries.length) throw new AppError('No valid issue quantities provided.', 400);

    // Post ledger entries
    await StockLedger.insertMany(ledgerEntries, { session });

    // Mark SIV as issued
    siv.status = 'approved'; // stays approved, issuedAt marks it as physically issued
    siv.issuedAt = new Date();
    siv.issuedBy = req.user._id;
    siv.receivedBy = receivedBy || null;
    await siv.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      message: `${siv.sivNumber} issued. Stock deducted.`,
      data: {
        sivNumber: siv.sivNumber,
        itemsIssued: ledgerEntries.length,
        issuedAt: siv.issuedAt,
      },
    });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};

// ── POST /api/v1/stock/sivs/:id/cancel ───────────────────────────────────────
exports.cancel = async (req, res, next) => {
  try {
    const siv = await StockIssueVoucher.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!siv) throw new AppError('SIV not found.', 404);
    if (siv.issuedAt) throw new AppError('Cannot cancel an already issued SIV.', 400);
    if (![APPROVAL_STATUS.DRAFT, APPROVAL_STATUS.PENDING].includes(siv.status)) {
      throw new AppError('Only draft or pending SIVs can be cancelled.', 400);
    }
    siv.status = APPROVAL_STATUS.CANCELLED;
    await siv.save();
    res.json({ success: true, message: 'SIV cancelled.' });
  } catch (err) { next(err); }
};
