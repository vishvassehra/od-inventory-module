const PurchaseRequisition = require('./pr.model');
const Counter = require('./counter.model');
const { APPROVAL_STATUS, ROLES } = require('../../config/constants');
const { AppError } = require('../../middleware/errorHandler');

const populateOptions = [
  { path: 'departmentId', select: 'name code' },
  { path: 'warehouseId', select: 'name code' },
  { path: 'lines.itemId', select: 'name itemCode' },
  { path: 'lines.uomId', select: 'name code' },
  { path: 'createdBy', select: 'name email' },
  { path: 'submittedBy', select: 'name' },
  { path: 'hodApprovedBy', select: 'name' },
];

// ── GET /api/v1/purchase/prs ─────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, departmentId, priority, search } = req.query;
    const filter = { tenantId: req.tenantId };

    if (status) filter.status = status;
    if (departmentId) filter.departmentId = departmentId;
    if (priority) filter.priority = priority;

    // HOD sees only their dept; dept staff sees only their own
    if (req.user.role === ROLES.HOD) {
      filter.departmentId = req.user.departmentId;
    } else if (req.user.role === ROLES.DEPT_STAFF) {
      filter.createdBy = req.user._id;
    }

    if (search) filter.prNumber = { $regex: search, $options: 'i' };

    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      PurchaseRequisition.find(filter)
        .populate(populateOptions)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      PurchaseRequisition.countDocuments(filter),
    ]);

    res.json({
      success: true, data,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) { next(err); }
};

// ── GET /api/v1/purchase/prs/:id ─────────────────────────────────────────────
exports.getOne = async (req, res, next) => {
  try {
    const pr = await PurchaseRequisition.findOne({ _id: req.params.id, tenantId: req.tenantId })
      .populate(populateOptions).lean();
    if (!pr) throw new AppError('PR not found.', 404);
    res.json({ success: true, data: pr });
  } catch (err) { next(err); }
};

// ── POST /api/v1/purchase/prs ────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const fy = Counter.currentFY();
    const prNumber = await Counter.next(req.tenantId, 'PR', fy);

    const pr = await PurchaseRequisition.create({
      ...req.body,
      tenantId: req.tenantId,
      prNumber,
      status: APPROVAL_STATUS.DRAFT,
      createdBy: req.user._id,
    });

    const populated = await PurchaseRequisition.findById(pr._id).populate(populateOptions).lean();
    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
};

// ── PATCH /api/v1/purchase/prs/:id ──────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const pr = await PurchaseRequisition.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!pr) throw new AppError('PR not found.', 404);
    if (pr.status !== APPROVAL_STATUS.DRAFT) {
      throw new AppError('Only draft PRs can be edited.', 400);
    }
    const allowed = ['lines', 'departmentId', 'warehouseId', 'requiredByDate', 'purpose', 'priority', 'remarks'];
    allowed.forEach((k) => { if (req.body[k] !== undefined) pr[k] = req.body[k]; });
    await pr.save();
    const populated = await PurchaseRequisition.findById(pr._id).populate(populateOptions).lean();
    res.json({ success: true, data: populated });
  } catch (err) { next(err); }
};

// ── POST /api/v1/purchase/prs/:id/submit ────────────────────────────────────
exports.submit = async (req, res, next) => {
  try {
    const pr = await PurchaseRequisition.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!pr) throw new AppError('PR not found.', 404);
    if (pr.status !== APPROVAL_STATUS.DRAFT) throw new AppError('PR is not in draft state.', 400);
    if (String(pr.createdBy) !== String(req.user._id) && req.user.role !== ROLES.INST_ADMIN) {
      throw new AppError('Only the PR creator can submit it.', 403);
    }
    pr.status = APPROVAL_STATUS.PENDING;
    pr.submittedAt = new Date();
    pr.submittedBy = req.user._id;
    await pr.save();
    res.json({ success: true, message: 'PR submitted for HOD approval.', data: { prNumber: pr.prNumber, status: pr.status } });
  } catch (err) { next(err); }
};

// ── POST /api/v1/purchase/prs/:id/approve ───────────────────────────────────
exports.approve = async (req, res, next) => {
  try {
    const pr = await PurchaseRequisition.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!pr) throw new AppError('PR not found.', 404);
    if (pr.status !== APPROVAL_STATUS.PENDING) throw new AppError('PR is not pending approval.', 400);

    // HOD can only approve their own dept PRs
    if (req.user.role === ROLES.HOD) {
      if (String(pr.departmentId) !== String(req.user.departmentId)) {
        throw new AppError('You can only approve PRs from your department.', 403);
      }
      pr.hodApprovedAt = new Date();
      pr.hodApprovedBy = req.user._id;
    }

    pr.status = APPROVAL_STATUS.APPROVED;
    pr.remarks = req.body.remarks || pr.remarks;
    await pr.save();
    res.json({ success: true, message: 'PR approved.', data: { prNumber: pr.prNumber, status: pr.status } });
  } catch (err) { next(err); }
};

// ── POST /api/v1/purchase/prs/:id/reject ────────────────────────────────────
exports.reject = async (req, res, next) => {
  try {
    if (!req.body.reason) throw new AppError('Rejection reason is required.', 400);
    const pr = await PurchaseRequisition.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!pr) throw new AppError('PR not found.', 404);
    if (pr.status !== APPROVAL_STATUS.PENDING) throw new AppError('PR is not pending approval.', 400);

    if (req.user.role === ROLES.HOD && String(pr.departmentId) !== String(req.user.departmentId)) {
      throw new AppError('You can only reject PRs from your department.', 403);
    }

    pr.status = APPROVAL_STATUS.REJECTED;
    pr.rejectionReason = req.body.reason;
    pr.hodRejectedAt = new Date();
    await pr.save();
    res.json({ success: true, message: 'PR rejected.', data: { prNumber: pr.prNumber, status: pr.status } });
  } catch (err) { next(err); }
};

// ── DELETE /api/v1/purchase/prs/:id ─────────────────────────────────────────
exports.cancel = async (req, res, next) => {
  try {
    const pr = await PurchaseRequisition.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!pr) throw new AppError('PR not found.', 404);
    if (![APPROVAL_STATUS.DRAFT, APPROVAL_STATUS.PENDING].includes(pr.status)) {
      throw new AppError('Only draft or pending PRs can be cancelled.', 400);
    }
    pr.status = APPROVAL_STATUS.CANCELLED;
    await pr.save();
    res.json({ success: true, message: 'PR cancelled.' });
  } catch (err) { next(err); }
};
