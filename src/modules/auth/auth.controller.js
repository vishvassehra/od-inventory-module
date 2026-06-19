const jwt = require('jsonwebtoken');
const User = require('./user.model');
const Instance = require('../superadmin/instance.model');
const { ROLES } = require('../../config/constants');
const { AppError } = require('../../middleware/errorHandler');
const logger = require('../../config/logger');

// ── Token generators ─────────────────────────────────────────────────────────
const signAccessToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });

const signRefreshToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });

const buildUserPayload = (user, instance = null) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  tenantId: user.tenantId,
  departmentId: user.departmentId,
  warehouseId: user.warehouseId,
  mustChangePassword: user.mustChangePassword,
  ...(instance && {
    instance: {
      name: instance.name,
      type: instance.type,
      modules: instance.modules,
    },
  }),
});

// ── POST /api/v1/auth/login ──────────────────────────────────────────────────
exports.login = async (req, res, next) => {
  try {
    const { email, password, tenantId } = req.body;

    if (!email || !password) {
      throw new AppError('Email and password are required.', 400);
    }

    // Super admin login has no tenantId
    // Institution users must supply tenantId to scope the search correctly
    const query = { email: email.toLowerCase().trim() };
    if (tenantId) {
      query.tenantId = tenantId;
    } else {
      query.role = ROLES.SUPER_ADMIN; // only SA can login without tenantId
    }

    const user = await User.findOne(query).select('+password +passwordChangedAt');

    if (!user || !(await user.comparePassword(password))) {
      throw new AppError('Invalid email or password.', 401);
    }

    if (!user.isActive) {
      throw new AppError('Your account has been deactivated. Contact your administrator.', 403);
    }

    // For institution users, verify instance is active
    let instance = null;
    if (user.tenantId) {
      instance = await Instance.findOne({ tenantId: user.tenantId, isActive: true })
        .select('name type modules')
        .lean();

      if (!instance) {
        throw new AppError('Institution account is inactive.', 403);
      }
    }

    // Update last login
    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });

    const accessToken = signAccessToken(user._id);
    const refreshToken = signRefreshToken(user._id);

    logger.info(`Login: ${user.email} [${user.role}] tenant:${user.tenantId || 'super'}`);

    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: buildUserPayload(user, instance),
    });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/auth/refresh ────────────────────────────────────────────────
exports.refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new AppError('Refresh token required.', 400);

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      throw new AppError('Invalid or expired refresh token.', 401);
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) throw new AppError('User not found or inactive.', 401);

    res.json({
      success: true,
      accessToken: signAccessToken(user._id),
    });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/auth/me ──────────────────────────────────────────────────────
exports.me = async (req, res, next) => {
  try {
    let instance = null;
    if (req.user.tenantId) {
      instance = await Instance.findOne({ tenantId: req.user.tenantId })
        .select('name type modules')
        .lean();
    }
    res.json({ success: true, user: buildUserPayload(req.user, instance) });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/auth/change-password ───────────────────────────────────────
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new AppError('Current and new password are required.', 400);
    }
    if (newPassword.length < 8) {
      throw new AppError('New password must be at least 8 characters.', 400);
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!(await user.comparePassword(currentPassword))) {
      throw new AppError('Current password is incorrect.', 400);
    }

    user.password = newPassword;
    user.mustChangePassword = false;
    await user.save();

    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    next(err);
  }
};
