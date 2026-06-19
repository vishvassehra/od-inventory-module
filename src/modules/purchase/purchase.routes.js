const express = require('express');
const router = express.Router();
const { protect, tenantGuard, roleGuard } = require('../../middleware/auth');
const { ROLES } = require('../../config/constants');

const prCtrl = require('./pr.controller');
const poCtrl = require('./po.controller');
const grnCtrl = require('./grn.controller');

const auth = [protect, tenantGuard];
const canRead = [...auth];
const purchaseTeam = [...auth, roleGuard(ROLES.INST_ADMIN, ROLES.PURCHASE_OFFICER, ROLES.STORE_MANAGER)];
const approverRoles = [...auth, roleGuard(ROLES.INST_ADMIN, ROLES.HOD)];
const adminAndPurchase = [...auth, roleGuard(ROLES.INST_ADMIN, ROLES.PURCHASE_OFFICER)];
const storeOnly = [...auth, roleGuard(ROLES.INST_ADMIN, ROLES.STORE_MANAGER)];

// ── PR Routes ────────────────────────────────────────────────────────────────
router.get('/prs', ...canRead, prCtrl.list);
router.get('/prs/:id', ...canRead, prCtrl.getOne);
router.post('/prs', ...auth, prCtrl.create);                          // any logged-in user can raise a PR
router.patch('/prs/:id', ...auth, prCtrl.update);                     // creator can edit draft
router.post('/prs/:id/submit', ...auth, prCtrl.submit);               // creator submits
router.post('/prs/:id/approve', ...approverRoles, prCtrl.approve);    // HOD / inst admin approves
router.post('/prs/:id/reject', ...approverRoles, prCtrl.reject);      // HOD / inst admin rejects
router.post('/prs/:id/cancel', ...auth, prCtrl.cancel);

// ── PO Routes ────────────────────────────────────────────────────────────────
router.get('/pos', ...canRead, poCtrl.list);
router.get('/pos/:id', ...canRead, poCtrl.getOne);
router.post('/pos', ...adminAndPurchase, poCtrl.create);
router.patch('/pos/:id', ...adminAndPurchase, poCtrl.update);
router.post('/pos/:id/submit', ...adminAndPurchase, poCtrl.submit);
router.post('/pos/:id/approve', ...auth, roleGuard(ROLES.INST_ADMIN), poCtrl.approve);
router.post('/pos/:id/reject', ...auth, roleGuard(ROLES.INST_ADMIN), poCtrl.reject);
router.post('/pos/:id/send', ...adminAndPurchase, poCtrl.sendToVendor);

// ── GRN Routes ────────────────────────────────────────────────────────────────
router.get('/grns', ...canRead, grnCtrl.list);
router.get('/grns/:id', ...canRead, grnCtrl.getOne);
router.post('/grns', ...storeOnly, grnCtrl.create);
router.post('/grns/:id/post', ...storeOnly, grnCtrl.post);   // THE stock-posting action

module.exports = router;
