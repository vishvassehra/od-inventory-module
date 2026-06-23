const OpeningStock = require('./openingStock.model');
const StockLedger  = require('./stockLedger.model');
const Counter      = require('../purchase/counter.model');
const { LEDGER_TXN_TYPE } = require('../../config/constants');
const { AppError } = require('../../middleware/errorHandler');
const mongoose     = require('mongoose');

// ── Helper: derive FY string from any date (Indian FY: Apr–Mar) ──────────────
// e.g. 2026-04-01 → "26-27",  2026-01-15 → "25-26"
function getFYFromDate(dateStr) {
  const d = new Date(dateStr);
  const year  = d.getFullYear();
  const month = d.getMonth() + 1; // 1-based
  const startYear = month >= 4 ? year : year - 1;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

// ── GET /api/v1/stock/opening/fy-status?asOfDate=YYYY-MM-DD ─────────────────
// Frontend calls this on date change to show FY lock status before user fills lines.
exports.fyStatus = async (req, res, next) => {
  try {
    const { asOfDate } = req.query;
    if (!asOfDate) throw new AppError('asOfDate query param is required.', 400);

    const fy  = getFYFromDate(asOfDate);
    const existing = await OpeningStock.findOne(
      { tenantId: req.tenantId, fy },
      'referenceNo asOfDate postedAt createdBy'
    ).populate('createdBy', 'name').lean();

    if (existing) {
      return res.json({
        success: true,
        locked: true,
        fy,
        referenceNo: existing.referenceNo,
        postedAt:    existing.postedAt,
        postedBy:    existing.createdBy?.name || '—',
      });
    }

    res.json({ success: true, locked: false, fy });
  } catch (err) { next(err); }
};

// ── GET /api/v1/stock/opening ─────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const data = await OpeningStock.find({ tenantId: req.tenantId })
      .populate([
        { path: 'lines.itemId',      select: 'name itemCode' },
        { path: 'lines.warehouseId', select: 'name code' },
        { path: 'lines.uomId',       select: 'name code' },
        { path: 'createdBy',         select: 'name' },
        { path: 'postedBy',          select: 'name' },
      ])
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

// ── POST /api/v1/stock/opening ────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { lines, asOfDate, remarks } = req.body;

    // ── Basic validation ──────────────────────────────────────────────────────
    if (!asOfDate)              throw new AppError('As-of date is required.', 400);
    if (!lines || !lines.length) throw new AppError('At least one line is required.', 400);

    // ── Compute FY from the supplied asOfDate ─────────────────────────────────
    const fy = getFYFromDate(asOfDate);

    // ── HARD FY LOCK — one OSE per FY per tenant ─────────────────────────────
    const existing = await OpeningStock.findOne(
      { tenantId: req.tenantId, fy },
      'referenceNo postedAt'
    ).lean();

    if (existing) {
      throw new AppError(
        `Opening stock for FY ${fy} is already posted (${existing.referenceNo}). ` +
        `Use Stock Adjustment to correct any errors. No second entry is allowed for the same financial year.`,
        409
      );
    }

    // ── Within-OSE duplicate check: same item + same warehouse ───────────────
    const seen = new Set();
    for (const line of lines) {
      if (!line.itemId || !line.warehouseId) continue;
      const key = `${line.itemId}::${line.warehouseId}`;
      if (seen.has(key)) {
        throw new AppError(
          `Duplicate line detected: the same item appears more than once for the same warehouse. ` +
          `Combine duplicate lines into a single entry before posting.`,
          400
        );
      }
      seen.add(key);
    }

    // ── Filter out zero-qty lines (frontend should prevent, but be safe) ─────
    const validLines = lines.filter(l => l.itemId && l.warehouseId && l.uomId && Number(l.qty) > 0);
    if (!validLines.length) throw new AppError('No valid lines with quantity > 0 found.', 400);

    // ── Generate reference number ─────────────────────────────────────────────
    const referenceNo = await Counter.next(req.tenantId, 'OSE', fy);

    // ── Create OSE document ───────────────────────────────────────────────────
    const [entry] = await OpeningStock.create([{
      tenantId: req.tenantId,
      referenceNo,
      fy,
      asOfDate: new Date(asOfDate),
      lines:    validLines,
      remarks,
      createdBy: req.user._id,
    }], { session });

    // ── Post ledger entries ───────────────────────────────────────────────────
    const ledgerEntries = validLines.map(l => ({
      tenantId:    req.tenantId,
      itemId:      l.itemId,
      warehouseId: l.warehouseId,
      txnType:     LEDGER_TXN_TYPE.OPENING,
      qty:         +l.qty,
      unitRate:    l.unitRate || 0,
      refDocType:  'OSE',
      refDocId:    entry._id,
      refDocNo:    referenceNo,
      remarks:     remarks || 'Opening stock entry',
      createdBy:   req.user._id,
      txnDate:     new Date(asOfDate),
    }));

    await StockLedger.insertMany(ledgerEntries, { session });

    // ── Mark as posted ────────────────────────────────────────────────────────
    await OpeningStock.findByIdAndUpdate(
      entry._id,
      { isPosted: true, postedAt: new Date(), postedBy: req.user._id },
      { session }
    );

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: `Opening stock ${referenceNo} posted for FY ${fy} — ${validLines.length} item(s) across ${new Set(validLines.map(l => l.warehouseId)).size} warehouse(s).`,
      data: { referenceNo, fy, itemCount: validLines.length },
    });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};
