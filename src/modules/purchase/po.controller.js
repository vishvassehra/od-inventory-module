const PurchaseOrder = require('./po.model');
const PurchaseRequisition = require('./pr.model');
const Counter = require('./counter.model');
const { APPROVAL_STATUS, PO_STATUS, ROLES } = require('../../config/constants');
const { AppError } = require('../../middleware/errorHandler');

const populateOptions = [
  { path: 'vendorId', select: 'name code gstin contactPerson phone' },
  { path: 'warehouseId', select: 'name code' },
  { path: 'prIds', select: 'prNumber departmentId' },
  { path: 'lines.itemId', select: 'name itemCode' },
  { path: 'lines.uomId', select: 'name code' },
  { path: 'createdBy', select: 'name email' },
  { path: 'approvedBy', select: 'name' },
];

// ── GET /api/v1/purchase/pos ─────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, vendorId, search } = req.query;
    const filter = { tenantId: req.tenantId };
    if (status) filter.status = status;
    if (vendorId) filter.vendorId = vendorId;
    if (search) filter.poNumber = { $regex: search, $options: 'i' };

    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      PurchaseOrder.find(filter).populate(populateOptions).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      PurchaseOrder.countDocuments(filter),
    ]);
    res.json({ success: true, data, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) } });
  } catch (err) { next(err); }
};

// ── GET /api/v1/purchase/pos/:id ─────────────────────────────────────────────
exports.getOne = async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findOne({ _id: req.params.id, tenantId: req.tenantId })
      .populate(populateOptions).lean();
    if (!po) throw new AppError('PO not found.', 404);
    res.json({ success: true, data: po });
  } catch (err) { next(err); }
};

// ── POST /api/v1/purchase/pos ────────────────────────────────────────────────
// Can be created from approved PRs or directly (direct PO)
exports.create = async (req, res, next) => {
  try {
    const { prIds = [], lines, vendorId, warehouseId, deliveryDate, paymentTerms, remarks } = req.body;

    if (!lines || lines.length === 0) throw new AppError('PO must have at least one line item.', 400);
    if (!vendorId) throw new AppError('Vendor is required.', 400);
    if (!warehouseId) throw new AppError('Warehouse is required.', 400);

    // Validate all referenced PRs are approved and belong to this tenant
    if (prIds.length > 0) {
      const prs = await PurchaseRequisition.find({
        _id: { $in: prIds },
        tenantId: req.tenantId,
        status: APPROVAL_STATUS.APPROVED,
      });
      if (prs.length !== prIds.length) {
        throw new AppError('One or more PRs not found or not in approved status.', 400);
      }
    }

    const fy = Counter.currentFY();
    const poNumber = await Counter.next(req.tenantId, 'PO', fy);

    const po = await PurchaseOrder.create({
      tenantId: req.tenantId,
      poNumber,
      vendorId,
      warehouseId,
      prIds,
      deliveryDate,
      paymentTerms,
      lines,
      remarks,
      status: PO_STATUS.DRAFT,
      approvalStatus: APPROVAL_STATUS.DRAFT,
      createdBy: req.user._id,
    });

    // Update PR lines with poQty
    if (prIds.length > 0) {
      for (const line of lines) {
        if (line.prId && line.prLineId) {
          await PurchaseRequisition.updateOne(
            { _id: line.prId, 'lines._id': line.prLineId },
            { $inc: { 'lines.$.poQty': line.orderedQty } }
          );
        }
      }
    }

    const populated = await PurchaseOrder.findById(po._id).populate(populateOptions).lean();
    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
};

// ── PATCH /api/v1/purchase/pos/:id ───────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!po) throw new AppError('PO not found.', 404);
    if (po.status !== PO_STATUS.DRAFT) throw new AppError('Only draft POs can be edited.', 400);

    const allowed = ['lines', 'vendorId', 'warehouseId', 'deliveryDate', 'paymentTerms', 'remarks'];
    allowed.forEach((k) => { if (req.body[k] !== undefined) po[k] = req.body[k]; });

    if (req.body.amendmentNote) {
      po.amendmentNo += 1;
      po.amendmentLog.push({ amendedAt: new Date(), amendedBy: req.user._id, changes: req.body.amendmentNote });
    }

    await po.save();
    const populated = await PurchaseOrder.findById(po._id).populate(populateOptions).lean();
    res.json({ success: true, data: populated });
  } catch (err) { next(err); }
};

// ── POST /api/v1/purchase/pos/:id/submit ─────────────────────────────────────
exports.submit = async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!po) throw new AppError('PO not found.', 404);
    if (po.status !== PO_STATUS.DRAFT) throw new AppError('PO is not in draft state.', 400);
    po.approvalStatus = APPROVAL_STATUS.PENDING;
    await po.save();
    res.json({ success: true, message: 'PO submitted for approval.', data: { poNumber: po.poNumber, approvalStatus: po.approvalStatus } });
  } catch (err) { next(err); }
};

// ── POST /api/v1/purchase/pos/:id/approve ────────────────────────────────────
exports.approve = async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!po) throw new AppError('PO not found.', 404);
    if (po.approvalStatus !== APPROVAL_STATUS.PENDING) throw new AppError('PO is not pending approval.', 400);

    po.approvalStatus = APPROVAL_STATUS.APPROVED;
    po.status = PO_STATUS.CONFIRMED;
    po.approvedAt = new Date();
    po.approvedBy = req.user._id;
    await po.save();
    res.json({ success: true, message: 'PO approved.', data: { poNumber: po.poNumber, status: po.status } });
  } catch (err) { next(err); }
};

// ── POST /api/v1/purchase/pos/:id/reject ─────────────────────────────────────
exports.reject = async (req, res, next) => {
  try {
    if (!req.body.reason) throw new AppError('Rejection reason is required.', 400);
    const po = await PurchaseOrder.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!po) throw new AppError('PO not found.', 404);
    if (po.approvalStatus !== APPROVAL_STATUS.PENDING) throw new AppError('PO is not pending approval.', 400);
    po.approvalStatus = APPROVAL_STATUS.REJECTED;
    po.status = PO_STATUS.CANCELLED;
    po.rejectedAt = new Date();
    po.rejectionReason = req.body.reason;
    await po.save();
    res.json({ success: true, message: 'PO rejected.', data: { poNumber: po.poNumber } });
  } catch (err) { next(err); }
};

// ── POST /api/v1/purchase/pos/:id/send ───────────────────────────────────────
exports.sendToVendor = async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!po) throw new AppError('PO not found.', 404);
    if (po.approvalStatus !== APPROVAL_STATUS.APPROVED) throw new AppError('PO must be approved before sending.', 400);
    po.status = PO_STATUS.SENT;
    po.sentToVendorAt = new Date();
    await po.save();
    res.json({ success: true, message: 'PO marked as sent to vendor.', data: { poNumber: po.poNumber, status: po.status } });
  } catch (err) { next(err); }
};
