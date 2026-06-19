const Vendor = require('./vendor.model');
const masterCRUD = require('./masterCRUD.factory');
const { AppError } = require('../../middleware/errorHandler');

const base = masterCRUD(Vendor, {
  searchFields: ['name', 'code', 'gstin', 'contactPerson'],
  uniqueCodeField: 'code',
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.toggleActive = base.toggleActive;

// ── PATCH /api/v1/masters/vendors/:id/blacklist ──────────────────────────────
exports.toggleBlacklist = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!vendor) throw new AppError('Vendor not found.', 404);

    vendor.isBlacklisted = !vendor.isBlacklisted;
    vendor.blacklistReason = vendor.isBlacklisted ? (req.body.reason || null) : null;
    if (vendor.isBlacklisted) vendor.isActive = false;
    await vendor.save();

    res.json({
      success: true,
      message: `Vendor ${vendor.isBlacklisted ? 'blacklisted' : 'removed from blacklist'}.`,
      data: { _id: vendor._id, isBlacklisted: vendor.isBlacklisted, isActive: vendor.isActive },
    });
  } catch (err) {
    next(err);
  }
};
