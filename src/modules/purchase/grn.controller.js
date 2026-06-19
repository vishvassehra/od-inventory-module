const GRN = require('./grn.model');
const PurchaseOrder = require('./po.model');
const Item = require('../masters/item.model');
const StockLedger = require('../stock/stockLedger.model');
const Counter = require('./counter.model');
const { GRN_STATUS, PO_STATUS, LEDGER_TXN_TYPE } = require('../../config/constants');
const { AppError } = require('../../middleware/errorHandler');
const mongoose = require('mongoose');

const populateOptions = [
  { path: 'poId', select: 'poNumber vendorId' },
  { path: 'vendorId', select: 'name code' },
  { path: 'warehouseId', select: 'name code' },
  { path: 'lines.itemId', select: 'name itemCode isAsset' },
  { path: 'lines.uomId', select: 'name code' },
  { path: 'createdBy', select: 'name email' },
  { path: 'postedBy', select: 'name' },
];

// ── GET /api/v1/purchase/grns ─────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, poId, vendorId } = req.query;
    const filter = { tenantId: req.tenantId };
    if (status) filter.status = status;
    if (poId) filter.poId = poId;
    if (vendorId) filter.vendorId = vendorId;

    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      GRN.find(filter).populate(populateOptions).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      GRN.countDocuments(filter),
    ]);
    res.json({ success: true, data, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) } });
  } catch (err) { next(err); }
};

// ── GET /api/v1/purchase/grns/:id ─────────────────────────────────────────────
exports.getOne = async (req, res, next) => {
  try {
    const grn = await GRN.findOne({ _id: req.params.id, tenantId: req.tenantId }).populate(populateOptions).lean();
    if (!grn) throw new AppError('GRN not found.', 404);
    res.json({ success: true, data: grn });
  } catch (err) { next(err); }
};

// ── POST /api/v1/purchase/grns ────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { poId, lines, vendorInvoiceNo, vendorInvoiceDate, vehicleNo, dcNo, remarks } = req.body;
    if (!poId) throw new AppError('PO reference is required.', 400);
    if (!lines || lines.length === 0) throw new AppError('GRN must have at least one line.', 400);

    const po = await PurchaseOrder.findOne({ _id: poId, tenantId: req.tenantId });
    if (!po) throw new AppError('PO not found.', 404);
    if (![PO_STATUS.CONFIRMED, PO_STATUS.SENT, PO_STATUS.PARTIAL].includes(po.status)) {
      throw new AppError('PO must be confirmed/sent before creating a GRN.', 400);
    }

    // Rate variance check — flag if any line deviates > 5% from PO rate
    let hasRateVariance = false;
    for (const line of lines) {
      const poLine = po.lines.id(line.poLineId);
      if (poLine && line.unitRate) {
        const deviation = Math.abs(line.unitRate - poLine.unitRate) / poLine.unitRate;
        if (deviation > 0.05) hasRateVariance = true;
      }
      // Auto-set rejectedQty
      line.rejectedQty = (line.receivedQty || 0) - (line.acceptedQty || 0);
      if (line.rejectedQty < 0) throw new AppError('Accepted qty cannot exceed received qty.', 400);
    }

    const fy = Counter.currentFY();
    const grnNumber = await Counter.next(req.tenantId, 'GRN', fy);

    const grn = await GRN.create({
      tenantId: req.tenantId,
      grnNumber,
      poId,
      vendorId: po.vendorId,
      warehouseId: req.body.warehouseId || po.warehouseId,
      vendorInvoiceNo, vendorInvoiceDate, vehicleNo, dcNo,
      lines,
      hasRateVariance,
      remarks,
      status: GRN_STATUS.DRAFT,
      createdBy: req.user._id,
    });

    const populated = await GRN.findById(grn._id).populate(populateOptions).lean();
    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
};

// ── POST /api/v1/purchase/grns/:id/post ──────────────────────────────────────
// THE critical action — posts stock to ledger, updates PO status
exports.post = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const grn = await GRN.findOne({ _id: req.params.id, tenantId: req.tenantId }).session(session);
    if (!grn) throw new AppError('GRN not found.', 404);
    if (grn.status !== GRN_STATUS.DRAFT) throw new AppError('GRN is already posted.', 400);

    const po = await PurchaseOrder.findById(grn.poId).session(session);
    if (!po) throw new AppError('Associated PO not found.', 404);

    // ── Build ledger entries for each accepted line ───────────────────────────
    const ledgerEntries = grn.lines.map((line) => ({
      tenantId: req.tenantId,
      itemId: line.itemId,
      warehouseId: grn.warehouseId,
      txnType: LEDGER_TXN_TYPE.GRN,
      qty: line.acceptedQty,           // only accepted qty enters stock
      unitRate: line.unitRate,
      refDocType: 'GRN',
      refDocId: grn._id,
      refDocNo: grn.grnNumber,
      remarks: line.qcRemarks,
      createdBy: req.user._id,
      txnDate: new Date(),
    }));

    await StockLedger.insertMany(ledgerEntries, { session });

    // ── Update receivedQty on PO lines ────────────────────────────────────────
    let allReceived = true;
    for (const line of grn.lines) {
      if (line.poLineId) {
        await PurchaseOrder.updateOne(
          { _id: grn.poId, 'lines._id': line.poLineId },
          { $inc: { 'lines.$.receivedQty': line.acceptedQty } },
          { session }
        );
      }
    }

    // Refresh PO to check if fully received
    const updatedPO = await PurchaseOrder.findById(grn.poId).session(session);
    for (const poLine of updatedPO.lines) {
      if (poLine.receivedQty < poLine.orderedQty) { allReceived = false; break; }
    }

    updatedPO.status = allReceived ? PO_STATUS.CLOSED : PO_STATUS.PARTIAL;
    await updatedPO.save({ session });

    // ── Update item lastPurchaseRate ──────────────────────────────────────────
    for (const line of grn.lines) {
      await Item.updateOne(
        { _id: line.itemId },
        { lastPurchaseRate: line.unitRate, lastPurchaseDate: new Date() },
        { session }
      );
    }

    // ── Mark GRN as posted ────────────────────────────────────────────────────
    grn.status = GRN_STATUS.POSTED;
    grn.isPartial = !allReceived;
    grn.postedAt = new Date();
    grn.postedBy = req.user._id;
    await grn.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      message: `GRN ${grn.grnNumber} posted. Stock updated. PO status: ${updatedPO.status}.`,
      data: {
        grnNumber: grn.grnNumber,
        status: grn.status,
        poStatus: updatedPO.status,
        ledgerEntriesCreated: ledgerEntries.length,
        hasRateVariance: grn.hasRateVariance,
      },
    });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};
