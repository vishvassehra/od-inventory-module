const express = require('express');
const router = express.Router();
const { protect, tenantGuard, roleGuard } = require('../../middleware/auth');
const { ROLES } = require('../../config/constants');
const {
  createInstance,
  listInstances,
  getInstance,
  updateInstance,
  toggleActive,
  createUserForInstance,
} = require('./superadmin.controller');

// All super admin routes require SA role
const saOnly = [protect, tenantGuard, roleGuard(ROLES.SUPER_ADMIN)];

router.get('/instances', ...saOnly, listInstances);
router.post('/instances', ...saOnly, createInstance);
router.get('/instances/:tenantId', ...saOnly, getInstance);
router.patch('/instances/:tenantId', ...saOnly, updateInstance);
router.patch('/instances/:tenantId/toggle-active', ...saOnly, toggleActive);
router.post('/instances/:tenantId/users', ...saOnly, createUserForInstance);

module.exports = router;
