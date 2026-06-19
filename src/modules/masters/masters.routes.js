const express = require('express');
const router = express.Router();

const { protect, tenantGuard, roleGuard } = require('../../middleware/auth');
const { ROLES } = require('../../config/constants');

// Models for factory-based controllers
const Category = require('./category.model');
const UOM = require('./uom.model');
const Warehouse = require('./warehouse.model');
const Department = require('./department.model');
const masterCRUD = require('./masterCRUD.factory');

// Specific controllers
const itemCtrl = require('./item.controller');
const vendorCtrl = require('./vendor.controller');

// Factory controllers
const categoryCtrl = masterCRUD(Category, {
  searchFields: ['name', 'code'],
  populateOn: [{ path: 'parentId', select: 'name code' }],
});

const uomCtrl = masterCRUD(UOM, { searchFields: ['name', 'code'] });

const warehouseCtrl = masterCRUD(Warehouse, {
  searchFields: ['name', 'code', 'location'],
  populateOn: [{ path: 'inchargeUserId', select: 'name email' }],
});

const departmentCtrl = masterCRUD(Department, {
  searchFields: ['name', 'code'],
  populateOn: [
    { path: 'hodUserId', select: 'name email' },
    { path: 'parentDeptId', select: 'name code' },
  ],
});

// Middleware stacks
const auth = [protect, tenantGuard];
const canRead = [...auth];
const canWrite = [...auth, roleGuard(ROLES.INST_ADMIN, ROLES.PURCHASE_OFFICER, ROLES.STORE_MANAGER)];
const adminOnly = [...auth, roleGuard(ROLES.INST_ADMIN)];

// CATEGORY
router.get('/categories', ...canRead, categoryCtrl.list);
router.get('/categories/:id', ...canRead, categoryCtrl.getOne);
router.post('/categories', ...canWrite, categoryCtrl.create);
router.patch('/categories/:id', ...canWrite, categoryCtrl.update);
router.patch('/categories/:id/toggle-active', ...adminOnly, categoryCtrl.toggleActive);

// UOM
router.get('/uoms', ...canRead, uomCtrl.list);
router.get('/uoms/:id', ...canRead, uomCtrl.getOne);
router.post('/uoms', ...canWrite, uomCtrl.create);
router.patch('/uoms/:id', ...canWrite, uomCtrl.update);
router.patch('/uoms/:id/toggle-active', ...adminOnly, uomCtrl.toggleActive);

// WAREHOUSE
router.get('/warehouses', ...canRead, warehouseCtrl.list);
router.get('/warehouses/:id', ...canRead, warehouseCtrl.getOne);
router.post('/warehouses', ...adminOnly, warehouseCtrl.create);
router.patch('/warehouses/:id', ...adminOnly, warehouseCtrl.update);
router.patch('/warehouses/:id/toggle-active', ...adminOnly, warehouseCtrl.toggleActive);

// DEPARTMENT
router.get('/departments', ...canRead, departmentCtrl.list);
router.get('/departments/:id', ...canRead, departmentCtrl.getOne);
router.post('/departments', ...adminOnly, departmentCtrl.create);
router.patch('/departments/:id', ...adminOnly, departmentCtrl.update);
router.patch('/departments/:id/toggle-active', ...adminOnly, departmentCtrl.toggleActive);

// ITEM
router.get('/items', ...canRead, itemCtrl.list);
router.get('/items/:id', ...canRead, itemCtrl.getOne);
router.post('/items', ...canWrite, itemCtrl.create);
router.patch('/items/:id', ...canWrite, itemCtrl.update);
router.patch('/items/:id/toggle-active', ...adminOnly, itemCtrl.toggleActive);

// VENDOR
router.get('/vendors', ...canRead, vendorCtrl.list);
router.get('/vendors/:id', ...canRead, vendorCtrl.getOne);
router.post('/vendors', ...canWrite, vendorCtrl.create);
router.patch('/vendors/:id', ...canWrite, vendorCtrl.update);
router.patch('/vendors/:id/toggle-active', ...adminOnly, vendorCtrl.toggleActive);
router.patch('/vendors/:id/blacklist', ...adminOnly, vendorCtrl.toggleBlacklist);

module.exports = router;
