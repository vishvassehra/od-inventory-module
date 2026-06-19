const Instance = require('./instance.model');
const User = require('../auth/user.model');
const { ROLES, INSTANCE_TYPE, INSTANCE_TIER } = require('../../config/constants');
const { AppError } = require('../../middleware/errorHandler');
const logger = require('../../config/logger');

// ── Generate a unique tenantId slug from institution name ────────────────────
const generateTenantId = async (name) => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .substring(0, 20);

  // Check for collisions and append suffix if needed
  let candidate = base;
  let suffix = 1;
  while (await Instance.exists({ tenantId: candidate })) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
};

// ── POST /api/v1/superadmin/instances ───────────────────────────────────────
exports.createInstance = async (req, res, next) => {
  try {
    const {
      name, shortName, type, tier,
      contactEmail, contactPhone, address,
      modules, fyStartMonth,
      adminName, adminEmail, adminPassword,
    } = req.body;

    // Validate required fields
    if (!name || !type || !adminName || !adminEmail || !adminPassword) {
      throw new AppError('name, type, adminName, adminEmail, adminPassword are required.', 400);
    }
    if (!Object.values(INSTANCE_TYPE).includes(type)) {
      throw new AppError(`Invalid type. Must be one of: ${Object.values(INSTANCE_TYPE).join(', ')}`, 400);
    }

    const tenantId = await generateTenantId(name);

    const instance = await Instance.create({
      tenantId,
      name,
      shortName,
      type,
      tier: tier || INSTANCE_TIER.STANDARD,
      contactEmail,
      contactPhone,
      address,
      modules,
      fyStartMonth,
      createdBy: req.user._id,
    });

    // Create the first institution admin
    const instAdmin = await User.create({
      tenantId,
      name: adminName,
      email: adminEmail,
      password: adminPassword,
      role: ROLES.INST_ADMIN,
      mustChangePassword: true,
      createdBy: req.user._id,
    });

    logger.info(`Instance created: ${tenantId} by superadmin ${req.user.email}`);

    res.status(201).json({
      success: true,
      message: 'Institution instance created successfully.',
      data: {
        instance: { tenantId: instance.tenantId, name: instance.name, type: instance.type },
        instAdmin: { _id: instAdmin._id, email: instAdmin.email, mustChangePassword: true },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/superadmin/instances ────────────────────────────────────────
exports.listInstances = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, type, isActive } = req.query;

    const filter = {};
    if (search) filter.name = { $regex: search, $options: 'i' };
    if (type) filter.type = type;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const skip = (Number(page) - 1) * Number(limit);
    const [instances, total] = await Promise.all([
      Instance.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .select('-__v')
        .lean(),
      Instance.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: instances,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/superadmin/instances/:tenantId ───────────────────────────────
exports.getInstance = async (req, res, next) => {
  try {
    const instance = await Instance.findOne({ tenantId: req.params.tenantId })
      .populate('createdBy', 'name email')
      .lean();

    if (!instance) throw new AppError('Instance not found.', 404);

    // Also fetch user count for this tenant
    const userCount = await User.countDocuments({ tenantId: req.params.tenantId });
    instance.stats = { ...instance.stats, totalUsers: userCount };

    res.json({ success: true, data: instance });
  } catch (err) {
    next(err);
  }
};

// ── PATCH /api/v1/superadmin/instances/:tenantId ─────────────────────────────
exports.updateInstance = async (req, res, next) => {
  try {
    const allowed = ['name', 'shortName', 'tier', 'contactEmail', 'contactPhone', 'address', 'modules', 'fyStartMonth', 'logoUrl'];
    const updates = {};
    allowed.forEach((key) => { if (req.body[key] !== undefined) updates[key] = req.body[key]; });

    const instance = await Instance.findOneAndUpdate(
      { tenantId: req.params.tenantId },
      updates,
      { new: true, runValidators: true }
    );

    if (!instance) throw new AppError('Instance not found.', 404);

    res.json({ success: true, data: instance });
  } catch (err) {
    next(err);
  }
};

// ── PATCH /api/v1/superadmin/instances/:tenantId/toggle-active ───────────────
exports.toggleActive = async (req, res, next) => {
  try {
    const instance = await Instance.findOne({ tenantId: req.params.tenantId });
    if (!instance) throw new AppError('Instance not found.', 404);

    instance.isActive = !instance.isActive;
    instance.deactivatedAt = instance.isActive ? null : new Date();
    await instance.save();

    logger.info(`Instance ${instance.tenantId} ${instance.isActive ? 'activated' : 'deactivated'} by ${req.user.email}`);

    res.json({
      success: true,
      message: `Instance ${instance.isActive ? 'activated' : 'deactivated'}.`,
      data: { tenantId: instance.tenantId, isActive: instance.isActive },
    });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/superadmin/instances/:tenantId/users ────────────────────────
// SA can create additional users for any instance (e.g. additional inst admins)
exports.createUserForInstance = async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { name, email, password, role } = req.body;

    const instance = await Instance.findOne({ tenantId });
    if (!instance) throw new AppError('Instance not found.', 404);

    // SA cannot create super_admin through this endpoint
    if (role === ROLES.SUPER_ADMIN) {
      throw new AppError('Cannot create super admin through instance user endpoint.', 403);
    }

    const user = await User.create({
      tenantId,
      name,
      email,
      password,
      role,
      mustChangePassword: true,
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      data: { _id: user._id, name: user.name, email: user.email, role: user.role, tenantId },
    });
  } catch (err) {
    next(err);
  }
};
