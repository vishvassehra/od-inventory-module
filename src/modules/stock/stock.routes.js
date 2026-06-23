const express = require('express');
const router = express.Router();
const { protect, tenantGuard, roleGuard } = require('../../middleware/auth');
const { ROLES } = require('../../config/constants');

const sivCtrl        = require('./siv.controller');
const returnCtrl     = require('./stockReturn.controller');
const openingCtrl    = require('./openingStock.controller');
const reportsCtrl    = require('./stockReports.controller');
const transferCtrl   = require('./stockTransfer.controller');
const adjustmentCtrl = require('./stockAdjustment.controller');

const auth          = [protect, tenantGuard];
const canRead       = [...auth];
const approverRoles = [...auth, roleGuard(ROLES.INST_ADMIN, ROLES.HOD)];
const storeAndAdmin = [...auth, roleGuard(ROLES.INST_ADMIN, ROLES.STORE_MANAGER)];
const adminOnly     = [...auth, roleGuard(ROLES.INST_ADMIN)];

// ── STOCK ISSUE VOUCHERS (SIV) ────────────────────────────────────────────────
router.get('/sivs',              ...canRead,       sivCtrl.list);
router.get('/sivs/:id',          ...canRead,       sivCtrl.getOne);
router.post('/sivs',             ...auth,          sivCtrl.create);       // any user can raise indent
router.patch('/sivs/:id',        ...auth,          sivCtrl.update);
router.post('/sivs/:id/submit',  ...auth,          sivCtrl.submit);
router.post('/sivs/:id/approve', ...approverRoles, sivCtrl.approve);
router.post('/sivs/:id/reject',  ...approverRoles, sivCtrl.reject);
router.post('/sivs/:id/issue',   ...storeAndAdmin, sivCtrl.issue);        // store manager issues stock
router.post('/sivs/:id/cancel',  ...auth,          sivCtrl.cancel);

// ── STOCK RETURNS ─────────────────────────────────────────────────────────────
router.get('/returns',    ...canRead,       returnCtrl.list);
router.get('/returns/:id',...canRead,       returnCtrl.getOne);
router.post('/returns',   ...storeAndAdmin, returnCtrl.create);           // auto-posts on create

// ── OPENING STOCK ─────────────────────────────────────────────────────────────
router.get('/opening/fy-status', ...adminOnly, openingCtrl.fyStatus);  // must be before /:id
router.get('/opening',           ...adminOnly, openingCtrl.list);
router.post('/opening',          ...adminOnly, openingCtrl.create);

// ── INTER-WAREHOUSE TRANSFERS ─────────────────────────────────────────────────
router.get('/transfers',          ...canRead,       transferCtrl.list);
router.get('/transfers/:id',      ...canRead,       transferCtrl.getOne);
router.post('/transfers',         ...storeAndAdmin, transferCtrl.create);
router.post('/transfers/:id/post',...storeAndAdmin, transferCtrl.post);

// ── STOCK ADJUSTMENTS ─────────────────────────────────────────────────────────
router.get('/adjustments',        ...adminOnly, adjustmentCtrl.list);
router.get('/adjustments/:id',    ...adminOnly, adjustmentCtrl.getOne);
router.post('/adjustments',       ...adminOnly, adjustmentCtrl.create);   // auto-posts on create

// ── REPORTS ───────────────────────────────────────────────────────────────────
router.get('/summary',           ...canRead, reportsCtrl.stockSummary);
router.get('/ledger',            ...canRead, reportsCtrl.stockLedger);
router.get('/low-stock',         ...canRead, reportsCtrl.lowStock);
router.get('/item-stock/:itemId',...canRead, reportsCtrl.itemStock);

module.exports = router;
