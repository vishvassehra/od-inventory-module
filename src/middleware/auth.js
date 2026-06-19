const jwt = require('jsonwebtoken');
const User = require('../modules/auth/user.model');
const Instance = require('../modules/superadmin/instance.model');
const { ROLES } = require('../config/constants');
const logger = require('../config/logger');

// ── Token helper ─────────────────────────────────────────────────────────────
const extractToken = (req) => {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return req.headers.authorization.split(' ')[1];
  }
  return null;
};

// ── protect ──────────────────────────────────────────────────────────────────
// Verifies JWT, attaches req.user. Required on every protected route.
const protect = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Access token required.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      const msg = err.name === 'TokenExpiredError' ? 'Token expired.' : 'Invalid token.';
      return res.status(401).json({ success: false, message: msg });
    }

    const user = await User.findById(decoded.id).select('+passwordChangedAt');
    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated.' });
    }

    if (user.passwordChangedAfter(decoded.iat)) {
      return res.status(401).json({ success: false, message: 'Password recently changed. Please log in again.' });
    }

    req.user = user;
    next();
  } catch (err) {
    logger.error('protect middleware error:', err);
    next(err);
  }
};

// ── tenantGuard ──────────────────────────────────────────────────────────────
// Ensures user belongs to an active instance and injects req.tenantId.
// Super admins bypass tenant check — they can operate cross-tenant.
// For super admin acting on a specific tenant, pass ?tenantId= query param.
const tenantGuard = async (req, res, next) => {
  try {
    const { user } = req;

    // Super admin: cross-tenant access
    if (user.role === ROLES.SUPER_ADMIN) {
      // If SA is scoping to a specific tenant (e.g. impersonation or lookup)
      const scopedTenantId = req.headers['x-tenant-id'] || req.query.tenantId || null;
      req.tenantId = scopedTenantId;
      req.isSuperAdmin = true;
      return next();
    }

    // All other roles must have a tenantId on their user record
    if (!user.tenantId) {
      return res.status(403).json({ success: false, message: 'User is not associated with any institution.' });
    }

    // Validate the instance is still active
    const instance = await Instance.findOne({ tenantId: user.tenantId, isActive: true })
      .select('tenantId modules isActive')
      .lean();

    if (!instance) {
      return res.status(403).json({ success: false, message: 'Institution account is inactive or not found.' });
    }

    req.tenantId = user.tenantId;
    req.instance = instance; // modules config available downstream
    req.isSuperAdmin = false;
    next();
  } catch (err) {
    logger.error('tenantGuard middleware error:', err);
    next(err);
  }
};

// ── roleGuard ────────────────────────────────────────────────────────────────
// Factory — pass one or more roles that are allowed on a route.
// Always use AFTER protect + tenantGuard.
//
// Usage:
//   router.post('/po', protect, tenantGuard, roleGuard(ROLES.PURCHASE_OFFICER, ROLES.INST_ADMIN), handler)
//
const roleGuard = (...allowedRoles) => (req, res, next) => {
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: `Access denied. Required role(s): ${allowedRoles.join(', ')}.`,
    });
  }
  next();
};

// ── moduleGuard ──────────────────────────────────────────────────────────────
// Checks that a specific module is enabled for the tenant.
// Usage: moduleGuard('assets')
const moduleGuard = (moduleName) => (req, res, next) => {
  if (req.isSuperAdmin) return next(); // SA always passes
  if (!req.instance?.modules?.[moduleName]) {
    return res.status(403).json({
      success: false,
      message: `The '${moduleName}' module is not enabled for your institution.`,
    });
  }
  next();
};

// ── selfOrRole ───────────────────────────────────────────────────────────────
// Allows access if the requester is the resource owner OR has one of the roles.
// Useful for profile endpoints.
const selfOrRole = (...allowedRoles) => (req, res, next) => {
  const isSelf = req.user._id.toString() === req.params.userId;
  const hasRole = allowedRoles.includes(req.user.role);
  if (!isSelf && !hasRole) {
    return res.status(403).json({ success: false, message: 'Access denied.' });
  }
  next();
};

module.exports = { protect, tenantGuard, roleGuard, moduleGuard, selfOrRole };
