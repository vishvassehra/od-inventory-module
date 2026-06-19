const Item = require('./item.model');
const Category = require('./category.model');
const masterCRUD = require('./masterCRUD.factory');
const { AppError } = require('../../middleware/errorHandler');

// Base CRUD from factory
const base = masterCRUD(Item, {
  searchFields: ['name', 'itemCode', 'description'],
  populateOn: [
    { path: 'categoryId', select: 'name code' },
    { path: 'uomId', select: 'name code' },
  ],
  uniqueCodeField: 'itemCode',
});

// ── Auto-generate itemCode from category prefix + sequence ──────────────────
// Format: {CATEGORY_CODE}-{4-digit-seq}  e.g. FURN-0003, STAT-0021
const generateItemCode = async (tenantId, categoryId) => {
  const category = await Category.findById(categoryId).select('code').lean();
  if (!category) throw new AppError('Category not found.', 404);

  const prefix = category.code.substring(0, 4); // first 4 chars of category code
  const regex = new RegExp(`^${prefix}-\\d{4}$`);

  // Find highest existing code for this prefix in this tenant
  const last = await Item.findOne({ tenantId, itemCode: regex })
    .sort({ itemCode: -1 })
    .select('itemCode')
    .lean();

  let seq = 1;
  if (last) {
    const parts = last.itemCode.split('-');
    seq = parseInt(parts[parts.length - 1], 10) + 1;
  }

  return `${prefix}-${String(seq).padStart(4, '0')}`;
};

// ── POST /api/v1/masters/items ───────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    // Auto-generate itemCode if not supplied
    if (!req.body.itemCode) {
      if (!req.body.categoryId) throw new AppError('categoryId is required to auto-generate item code.', 400);
      req.body.itemCode = await generateItemCode(req.tenantId, req.body.categoryId);
    }

    // isAsset and isConsumable are mutually set based on category
    const category = await Category.findById(req.body.categoryId).select('isAssetCategory').lean();
    if (category?.isAssetCategory) {
      req.body.isAsset = true;
      req.body.isConsumable = false;
    }

    const item = await Item.create({
      ...req.body,
      itemCode: req.body.itemCode.toUpperCase().trim(),
      tenantId: req.tenantId,
      createdBy: req.user._id,
    });

    const populated = await Item.findById(item._id)
      .populate('categoryId', 'name code')
      .populate('uomId', 'name code')
      .lean();

    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    next(err);
  }
};

// Reuse factory methods for the rest
exports.list = base.list;
exports.getOne = base.getOne;
exports.update = base.update;
exports.toggleActive = base.toggleActive;
