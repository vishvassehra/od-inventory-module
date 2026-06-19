const express = require('express');
const router = express.Router();
const { login, refresh, me, changePassword } = require('./auth.controller');
const { protect, tenantGuard } = require('../../middleware/auth');

router.post('/login', login);
router.post('/refresh', refresh);
router.get('/me', protect, tenantGuard, me);
router.post('/change-password', protect, tenantGuard, changePassword);

module.exports = router;
