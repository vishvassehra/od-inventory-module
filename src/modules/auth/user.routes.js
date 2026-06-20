const express = require('express');
const router = express.Router();
const { protect, tenantGuard, roleGuard, selfOrRole } = require('../../middleware/auth');
const { ROLES } = require('../../config/constants');
const User = require('./user.model');
const { AppError } = require('../../middleware/errorHandler');
const bcrypt = require('bcryptjs');

const adminOnly = [protect, tenantGuard, roleGuard(ROLES.INST_ADMIN)];
const auth = [protect, tenantGuard];

// GET /api/v1/users - list all users for tenant
router.get('/', ...adminOnly, async (req, res, next) => {
  try {
    const { page = 1, limit = 50, role, isActive, search } = req.query;
    const filter = { tenantId: req.tenantId };
    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      User.find(filter).select('-password').sort({ name: 1 }).skip(skip).limit(Number(limit))
        .populate('departmentId', 'name code')
        .populate('warehouseId', 'name code')
        .lean(),
      User.countDocuments(filter),
    ]);
    res.json({ success: true, data, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) } });
  } catch (err) { next(err); }
});

// POST /api/v1/users - create user within own tenant
router.post('/', ...adminOnly, async (req, res, next) => {
  try {
    const { name, email, password, role, departmentId, warehouseId } = req.body;
    if (!name || !email || !password || !role) throw new AppError('name, email, password, role required.', 400);
    if (role === ROLES.SUPER_ADMIN) throw new AppError('Cannot create super admin.', 403);
    const user = await User.create({ tenantId: req.tenantId, name, email, password, role, departmentId: departmentId || null, warehouseId: warehouseId || null, mustChangePassword: true, createdBy: req.user._id });
    const result = user.toObject(); delete result.password;
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
});

// PATCH /api/v1/users/:id - update user
router.patch('/:id', ...adminOnly, async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!user) throw new AppError('User not found.', 404);
    const allowed = ['name', 'role', 'departmentId', 'warehouseId', 'isActive'];
    allowed.forEach(k => { if (req.body[k] !== undefined) user[k] = req.body[k]; });
    await user.save();
    const result = user.toObject(); delete result.password;
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// PATCH /api/v1/users/:id/reset-password - admin resets password
router.patch('/:id/reset-password', ...adminOnly, async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) throw new AppError('Password must be at least 8 characters.', 400);
    const user = await User.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!user) throw new AppError('User not found.', 404);
    user.password = newPassword;
    user.mustChangePassword = true;
    await user.save();
    res.json({ success: true, message: 'Password reset. User must change on next login.' });
  } catch (err) { next(err); }
});

// PATCH /api/v1/users/:id/toggle-active
router.patch('/:id/toggle-active', ...adminOnly, async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!user) throw new AppError('User not found.', 404);
    if (user._id.equals(req.user._id)) throw new AppError('Cannot deactivate your own account.', 400);
    user.isActive = !user.isActive;
    await user.save();
    res.json({ success: true, data: { _id: user._id, isActive: user.isActive } });
  } catch (err) { next(err); }
});

module.exports = router;
