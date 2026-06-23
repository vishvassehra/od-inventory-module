const OpeningStock = require('./openingStock.model');
const StockLedger  = require('./stockLedger.model');
const Counter      = require('../purchase/counter.model');
const { LEDGER_TXN_TYPE } = require('../../config/constants');
const { AppError } = require('../../middleware/errorHandler');
const mongoose     = require('mongoose');

// ── Helpers ───────────────────────────────────────────────────────────────────

// Derive FY string from a date — Indian FY: April–March
// e.g. 2026-04-01 → "26-27",  2026-01-15 → "25-26"
function getFYFromDate(dateStr) {
  const d         = new Date(dateStr);
  const year      = d.getFullYear();
  const month     = d.getMonth() + 1; // 1-based
  const startYear = month >= 4 ? year : year - 1;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

// Get the earliest non-OSE transaction date for this tenant (across all items/warehouses)
async function getEarliestTxnDate(tenantId) {
  const result = await StockLedger.findOne(
    { tenantId, txnType: { $ne: LEDGER_TXN_TYPE.OPENING } },
    'txnDate'
  ).sort({ txnDate: 1 }).lean();
  return result?.txnDate || null;
}

// Check if a specific item+warehouse line is locked
// Locked = any non-OSE ledger entry exists for this item+warehouse on or after asOfDate
async function isLineLocked(tenantId, itemId, warehouseId, asOfDate) {
  const count = await StockLedger.countDocuments({
    tenantId,
    itemId:      new mongoose.Types.ObjectId(itemId),
    warehouseId: new mongoose.Types.ObjectId(warehouseId),
    txnType:     { $ne: LEDGER_TXN_TYPE.OPENING },
    txnDate:     { $gte: new Date(asOfDate) },
  });
  return count > 0;
}

// Check per-line lock status in bulk — returns a Set of "itemId::warehouseId" keys that are locked
async function getLockedLineKeys(tenantId, lines, asOfDate) {
  if (!lines.length) return new Set();
  const locked = new Set();
  // Run all checks in parallel
  await Promise.all(lines.map(async (l) => {
    const key = `${l.itemId}::${l.warehouseId}`;
    const isLocked = await isLineLocked(tenantId, l.itemId, l.warehouseId, asOfDate);
    if (isLocked) locked.add(key);
  }));
  return locked;
}

// Delete the OSE ledger entry for a specific item+warehouse (only refDocType: 'OSE' entries)
async function deleteOSELedgerEntry(tenantId, itemId, warehouseId, session) {
  return StockLedger.deleteMany({
    tenantId,
    itemId:      new mongoose.Types.ObjectId(itemId),
    warehouseId: new mongoose.Types.ObjectId(warehouseId),
    refDocType:  'OSE',
  }, { session });
}

// ── GET /api/v1/stock/opening ─────────────────────────────────────────────────
// Returns the single OSE document for this tenant with per-line isLocked status.
// Returns 200 with data: null if no OSE exists yet.
exports.get = async (req, res, next) => {
  try {
    const ose = await OpeningStock.findOne({ tenantId: req.tenantId })
      .populate([
        { path: 'lines.itemId',      select: 'name itemCode' },
        { path: 'lines.warehouseId', select: 'name code' },
        { path: 'lines.uomId',       select: 'name code' },
        { path: 'createdBy',         select: 'name' },
        { path: 'lastEditedBy',      select: 'name' },
      ])
      .lean();

    if (!ose) return res.json({ success: true, data: null });

    // Compute per-line lock status in bulk
    const lockedKeys = await getLockedLineKeys(
      req.tenantId,
      ose.lines.map(l => ({
        itemId:      l.itemId?._id || l.itemId,
        warehouseId: l.warehouseId?._id || l.warehouseId,
      })),
      ose.asOfDate
    );

    const linesWithStatus = ose.lines.map(l => ({
      ...l,
      isLocked: lockedKeys.has(
        `${(l.itemId?._id || l.itemId)}::${(l.warehouseId?._id || l.warehouseId)}`
      ),
    }));

    res.json({
      success: true,
      data: { ...ose, lines: linesWithStatus },
    });
  } catch (err) { next(err); }
};

// ── POST /api/v1/stock/opening ────────────────────────────────────────────────
// Creates the OSE document. Blocked if one already exists for this tenant.
// Writes ledger entries for all valid lines immediately.
exports.create = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { lines = [], asOfDate, remarks } = req.body;
    if (!asOfDate) throw new AppError('As-of date is required.', 400);

    // Block if OSE already exists — use PATCH to update
    const existing = await OpeningStock.findOne(
      { tenantId: req.tenantId },
      '_id referenceNo'
    ).lean();
    if (existing) {
      throw new AppError(
        `Opening stock document ${existing.referenceNo} already exists. ` +
        `Use the edit action to update it.`,
        409
      );
    }

    // ── asOfDate guard — cannot be after earliest existing transaction ────────
    const earliestTxn = await getEarliestTxnDate(req.tenantId);
    if (earliestTxn && new Date(asOfDate) > new Date(earliestTxn)) {
      throw new AppError(
        `As-of date ${asOfDate} is after an existing transaction dated ` +
        `${new Date(earliestTxn).toDateString()}. ` +
        `Opening stock date must be on or before the earliest transaction.`,
        400
      );
    }

    // ── Duplicate line check: same item + warehouse in the submitted list ─────
    const seen = new Set();
    for (const l of lines) {
      if (!l.itemId || !l.warehouseId) continue;
      const key = `${l.itemId}::${l.warehouseId}`;
      if (seen.has(key)) {
        throw new AppError(
          `Duplicate line: the same item appears more than once for the same warehouse. ` +
          `Combine duplicates into a single line.`,
          400
        );
      }
      seen.add(key);
    }

    const validLines = lines.filter(l => l.itemId && l.warehouseId && l.uomId && Number(l.qty) > 0);
    const fy         = getFYFromDate(asOfDate);
    const referenceNo = await Counter.next(req.tenantId, 'OSE', fy);

    // ── Create OSE document ───────────────────────────────────────────────────
    const [ose] = await OpeningStock.create([{
      tenantId:  req.tenantId,
      referenceNo,
      fy,
      asOfDate:  new Date(asOfDate),
      lines:     validLines,
      remarks,
      createdBy: req.user._id,
    }], { session });

    // ── Write ledger entries for all valid lines ──────────────────────────────
    if (validLines.length) {
      const ledgerEntries = validLines.map(l => ({
        tenantId:    req.tenantId,
        itemId:      l.itemId,
        warehouseId: l.warehouseId,
        txnType:     LEDGER_TXN_TYPE.OPENING,
        qty:         +l.qty,
        unitRate:    l.unitRate || 0,
        refDocType:  'OSE',
        refDocId:    ose._id,
        refDocNo:    referenceNo,
        remarks:     remarks || 'Opening stock',
        createdBy:   req.user._id,
        txnDate:     new Date(asOfDate),
      }));
      await StockLedger.insertMany(ledgerEntries, { session });
    }

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: `Opening stock ${referenceNo} created with ${validLines.length} line(s).`,
      data: { referenceNo, fy, lineCount: validLines.length },
    });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};

// ── PATCH /api/v1/stock/opening ───────────────────────────────────────────────
// Updates the OSE document lines.
// - Locked lines (transactions exist) are skipped — returned in response as skipped[]
// - Editable lines: old OSE ledger entry deleted, fresh one written
// - Lines removed from the request (and editable) are deleted from doc + ledger
// - remarks update is always allowed
exports.update = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { lines, remarks } = req.body;

    const ose = await OpeningStock.findOne({ tenantId: req.tenantId }).session(session);
    if (!ose) throw new AppError('No opening stock document found. Create one first.', 404);

    if (!Array.isArray(lines)) throw new AppError('lines must be an array.', 400);

    // ── Duplicate check in the submitted lines ────────────────────────────────
    const seen = new Set();
    for (const l of lines) {
      if (!l.itemId || !l.warehouseId) continue;
      const key = `${l.itemId}::${l.warehouseId}`;
      if (seen.has(key)) {
        throw new AppError(
          `Duplicate line: same item appears more than once for the same warehouse.`,
          400
        );
      }
      seen.add(key);
    }

    // ── Compute lock status for ALL lines (existing + incoming) ──────────────
    const allLineKeys = new Set([
      ...ose.lines.map(l => `${l.itemId}::${l.warehouseId}`),
      ...lines.map(l => `${l.itemId}::${l.warehouseId}`),
    ]);
    const allLineObjs = [...allLineKeys].map(k => {
      const [itemId, warehouseId] = k.split('::');
      return { itemId, warehouseId };
    });
    const lockedKeys = await getLockedLineKeys(req.tenantId, allLineObjs, ose.asOfDate);

    const updatedLines = [];
    const skippedLines = [];
    const removedLines = [];

    // ── Build a map of existing lines keyed by itemId::warehouseId ────────────
    const existingMap = new Map(
      ose.lines.map(l => [`${l.itemId}::${l.warehouseId}`, l])
    );

    // ── Process incoming lines ────────────────────────────────────────────────
    const incomingKeys = new Set();
    for (const l of lines) {
      if (!l.itemId || !l.warehouseId || !l.uomId || Number(l.qty) <= 0) continue;
      const key = `${l.itemId}::${l.warehouseId}`;
      incomingKeys.add(key);

      if (lockedKeys.has(key)) {
        skippedLines.push({ itemId: l.itemId, warehouseId: l.warehouseId, reason: 'transactions_exist' });
        continue;
      }

      // Editable — delete old OSE ledger entry and write fresh one
      await deleteOSELedgerEntry(req.tenantId, l.itemId, l.warehouseId, session);
      await StockLedger.create([{
        tenantId:    req.tenantId,
        itemId:      l.itemId,
        warehouseId: l.warehouseId,
        txnType:     LEDGER_TXN_TYPE.OPENING,
        qty:         +l.qty,
        unitRate:    l.unitRate || 0,
        refDocType:  'OSE',
        refDocId:    ose._id,
        refDocNo:    ose.referenceNo,
        remarks:     remarks || ose.remarks || 'Opening stock',
        createdBy:   req.user._id,
        txnDate:     ose.asOfDate,
      }], { session });
      updatedLines.push({ itemId: l.itemId, warehouseId: l.warehouseId, qty: l.qty, uomId: l.uomId, unitRate: l.unitRate || 0 });
    }

    // ── Remove lines that were in document but not in incoming (if editable) ──
    for (const [key, existingLine] of existingMap) {
      if (incomingKeys.has(key)) continue; // already processed above
      if (lockedKeys.has(key)) {
        // Can't remove — locked, keep it
        updatedLines.push(existingLine);
        continue;
      }
      // Editable and not in incoming — remove
      await deleteOSELedgerEntry(req.tenantId, existingLine.itemId, existingLine.warehouseId, session);
      removedLines.push({ itemId: existingLine.itemId, warehouseId: existingLine.warehouseId });
    }

    // ── Also keep locked lines that weren't in the incoming list ─────────────
    for (const [key, existingLine] of existingMap) {
      if (incomingKeys.has(key)) continue; // already processed
      if (lockedKeys.has(key)) updatedLines.push(existingLine); // kept above
    }

    // ── Rebuild the lines array on the OSE document ───────────────────────────
    // Keep: updated incoming editable + locked lines from existing
    const finalLines = [];
    // Locked existing lines not in incoming
    for (const [key, el] of existingMap) {
      if (!incomingKeys.has(key) && lockedKeys.has(key)) finalLines.push(el);
    }
    // All incoming valid lines (editable ones updated, locked ones skipped but kept if they existed)
    for (const l of lines) {
      if (!l.itemId || !l.warehouseId || !l.uomId || Number(l.qty) <= 0) continue;
      const key = `${l.itemId}::${l.warehouseId}`;
      if (lockedKeys.has(key) && existingMap.has(key)) {
        finalLines.push(existingMap.get(key)); // keep existing locked line as-is
      } else if (!lockedKeys.has(key)) {
        finalLines.push({ itemId: l.itemId, warehouseId: l.warehouseId, uomId: l.uomId, qty: +l.qty, unitRate: l.unitRate || 0 });
      }
    }

    ose.lines        = finalLines;
    ose.remarks      = remarks !== undefined ? remarks : ose.remarks;
    ose.lastEditedBy = req.user._id;
    ose.lastEditedAt = new Date();
    await ose.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      message: skippedLines.length
        ? `Saved ${updatedLines.length - (finalLines.length - updatedLines.length)} line(s). ${skippedLines.length} line(s) were skipped because transactions exist.`
        : `Opening stock updated — ${finalLines.length} line(s).`,
      data: {
        lineCount:    finalLines.length,
        skippedLines,
        removedCount: removedLines.length,
      },
    });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};

// ── PATCH /api/v1/stock/opening/date ─────────────────────────────────────────
// Change the asOfDate on the OSE document.
// Blocked if any OSE ledger entries exist (user must delete them first via Phase 2 endpoint).
// Blocked if new date is after the earliest non-OSE transaction.
exports.updateDate = async (req, res, next) => {
  try {
    const { asOfDate } = req.body;
    if (!asOfDate) throw new AppError('asOfDate is required.', 400);

    const ose = await OpeningStock.findOne({ tenantId: req.tenantId });
    if (!ose) throw new AppError('No opening stock document found. Create one first.', 404);

    // ── Block if OSE ledger entries exist ─────────────────────────────────────
    const oseEntryCount = await StockLedger.countDocuments({
      tenantId:   req.tenantId,
      refDocType: 'OSE',
    });
    if (oseEntryCount > 0) {
      throw new AppError(
        `Cannot change the opening date — ${oseEntryCount} opening stock ledger ` +
        `entries already exist. Delete those entries first, then change the date.`,
        409
      );
    }

    // ── Block if new date is after earliest non-OSE transaction ──────────────
    const earliestTxn = await getEarliestTxnDate(req.tenantId);
    if (earliestTxn && new Date(asOfDate) > new Date(earliestTxn)) {
      throw new AppError(
        `As-of date ${asOfDate} is after an existing transaction dated ` +
        `${new Date(earliestTxn).toDateString()}. ` +
        `Opening date must be on or before the earliest transaction.`,
        400
      );
    }

    const newFY       = getFYFromDate(asOfDate);
    ose.asOfDate      = new Date(asOfDate);
    ose.fy            = newFY;
    ose.lastEditedBy  = req.user._id;
    ose.lastEditedAt  = new Date();
    await ose.save();

    res.json({
      success: true,
      message: `Opening date updated to ${asOfDate} (FY ${newFY}).`,
      data: { asOfDate, fy: newFY },
    });
  } catch (err) { next(err); }
};

// ── GET /api/v1/stock/opening/line-transactions/:itemId/:warehouseId ──────────
// Returns all non-OSE ledger transactions for a specific item+warehouse
// on or after the OSE asOfDate. Powers the "View" button on locked lines.
exports.lineTransactions = async (req, res, next) => {
  try {
    const { itemId, warehouseId } = req.params;

    // Validate ObjectId format before querying
    if (
      !mongoose.Types.ObjectId.isValid(itemId) ||
      !mongoose.Types.ObjectId.isValid(warehouseId)
    ) {
      throw new AppError('Invalid itemId or warehouseId.', 400);
    }

    // Need asOfDate from OSE document to scope the query
    const ose = await OpeningStock.findOne(
      { tenantId: req.tenantId },
      'asOfDate referenceNo'
    ).lean();
    if (!ose) throw new AppError('No opening stock document found.', 404);

    // All non-OSE transactions for this item+warehouse on or after asOfDate
    const transactions = await StockLedger.find({
      tenantId:    req.tenantId,
      itemId:      new mongoose.Types.ObjectId(itemId),
      warehouseId: new mongoose.Types.ObjectId(warehouseId),
      txnType:     { $ne: LEDGER_TXN_TYPE.OPENING },
      txnDate:     { $gte: ose.asOfDate },
    })
      .populate('itemId',      'name itemCode')
      .populate('warehouseId', 'name code')
      .sort({ txnDate: 1 })
      .lean();

    res.json({
      success: true,
      data: transactions,
      meta: {
        count:     transactions.length,
        isLocked:  transactions.length > 0,
        asOfDate:  ose.asOfDate,
      },
    });
  } catch (err) { next(err); }
};

// ── DELETE /api/v1/stock/opening/ledger-entry/:itemId/:warehouseId ────────────
// Deletes the OSE ledger entry (refDocType: 'OSE') for a specific item+warehouse.
// Blocked if non-OSE transactions exist for this line — user must delete those first.
// After deletion the line's opening balance is cleared from the ledger;
// a subsequent PATCH /opening will write a fresh entry when the user saves.
exports.deleteLedgerEntry = async (req, res, next) => {
  try {
    const { itemId, warehouseId } = req.params;

    if (
      !mongoose.Types.ObjectId.isValid(itemId) ||
      !mongoose.Types.ObjectId.isValid(warehouseId)
    ) {
      throw new AppError('Invalid itemId or warehouseId.', 400);
    }

    const ose = await OpeningStock.findOne(
      { tenantId: req.tenantId },
      'asOfDate referenceNo lines'
    ).lean();
    if (!ose) throw new AppError('No opening stock document found.', 404);

    // ── Block if non-OSE transactions exist for this line ────────────────────
    // Deleting the opening entry while downstream transactions exist
    // would corrupt the running balance for this item+warehouse.
    const txnCount = await StockLedger.countDocuments({
      tenantId:    req.tenantId,
      itemId:      new mongoose.Types.ObjectId(itemId),
      warehouseId: new mongoose.Types.ObjectId(warehouseId),
      txnType:     { $ne: LEDGER_TXN_TYPE.OPENING },
      txnDate:     { $gte: ose.asOfDate },
    });

    if (txnCount > 0) {
      throw new AppError(
        `Cannot delete opening stock ledger entry — ${txnCount} transaction(s) exist ` +
        `for this item in this warehouse on or after ${new Date(ose.asOfDate).toDateString()}. ` +
        `Delete or reverse those transactions first, then retry.`,
        409
      );
    }

    // ── Delete only the OSE ledger entry for this item+warehouse ─────────────
    const result = await StockLedger.deleteMany({
      tenantId:    req.tenantId,
      itemId:      new mongoose.Types.ObjectId(itemId),
      warehouseId: new mongoose.Types.ObjectId(warehouseId),
      refDocType:  'OSE',
    });

    res.json({
      success: true,
      message: result.deletedCount > 0
        ? `Opening stock ledger entry deleted (${result.deletedCount} record).`
        : `No opening stock ledger entry found for this line — nothing deleted.`,
      data: { deletedCount: result.deletedCount },
    });
  } catch (err) { next(err); }
};
