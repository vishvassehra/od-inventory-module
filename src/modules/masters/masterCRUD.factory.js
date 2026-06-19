const { AppError } = require('../../middleware/errorHandler');

/**
 * Generic CRUD factory for master collections.
 * All masters share the same patterns — list, get, create, update, toggle-active.
 * Pass the Mongoose model and config options to get a full controller object.
 *
 * Usage:
 *   const ctrl = masterCRUD(Category, { searchFields: ['name', 'code'] });
 *   router.get('/', protect, tenantGuard, ctrl.list);
 */
const masterCRUD = (Model, options = {}) => {
  const {
    searchFields = ['name', 'code'],
    populateOn = [],          // array of populate objects for get/list
    uniqueCodeField = 'code', // field to check for duplicate on create
  } = options;

  // ── LIST ──────────────────────────────────────────────────────────────────
  const list = async (req, res, next) => {
    try {
      const { page = 1, limit = 50, search, isActive, ...extraFilters } = req.query;

      const filter = { tenantId: req.tenantId };

      if (isActive !== undefined) filter.isActive = isActive === 'true';

      // Text search across searchFields
      if (search) {
        filter.$or = searchFields.map((f) => ({
          [f]: { $regex: search, $options: 'i' },
        }));
      }

      // Allow extra filters passed as query params (e.g. categoryId, parentId)
      Object.keys(extraFilters).forEach((key) => {
        if (extraFilters[key]) filter[key] = extraFilters[key];
      });

      const skip = (Number(page) - 1) * Number(limit);

      let query = Model.find(filter).sort({ name: 1 }).skip(skip).limit(Number(limit));
      populateOn.forEach((p) => { query = query.populate(p); });

      const [data, total] = await Promise.all([
        query.lean(),
        Model.countDocuments(filter),
      ]);

      res.json({
        success: true,
        data,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          pages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (err) {
      next(err);
    }
  };

  // ── GET ONE ───────────────────────────────────────────────────────────────
  const getOne = async (req, res, next) => {
    try {
      let query = Model.findOne({ _id: req.params.id, tenantId: req.tenantId });
      populateOn.forEach((p) => { query = query.populate(p); });
      const doc = await query.lean();

      if (!doc) throw new AppError('Record not found.', 404);
      res.json({ success: true, data: doc });
    } catch (err) {
      next(err);
    }
  };

  // ── CREATE ────────────────────────────────────────────────────────────────
  const create = async (req, res, next) => {
    try {
      // Duplicate code check within tenant
      if (req.body[uniqueCodeField]) {
        const exists = await Model.findOne({
          tenantId: req.tenantId,
          [uniqueCodeField]: req.body[uniqueCodeField].toUpperCase().trim(),
        });
        if (exists) {
          throw new AppError(
            `A record with ${uniqueCodeField} '${req.body[uniqueCodeField]}' already exists.`,
            409
          );
        }
      }

      const doc = await Model.create({
        ...req.body,
        tenantId: req.tenantId,
        createdBy: req.user._id,
      });

      res.status(201).json({ success: true, data: doc });
    } catch (err) {
      next(err);
    }
  };

  // ── UPDATE ────────────────────────────────────────────────────────────────
  const update = async (req, res, next) => {
    try {
      // Prevent tenantId or createdBy tampering
      delete req.body.tenantId;
      delete req.body.createdBy;

      // If code is being changed, check for duplicate
      if (req.body[uniqueCodeField]) {
        const exists = await Model.findOne({
          tenantId: req.tenantId,
          [uniqueCodeField]: req.body[uniqueCodeField].toUpperCase().trim(),
          _id: { $ne: req.params.id },
        });
        if (exists) {
          throw new AppError(
            `A record with ${uniqueCodeField} '${req.body[uniqueCodeField]}' already exists.`,
            409
          );
        }
      }

      const doc = await Model.findOneAndUpdate(
        { _id: req.params.id, tenantId: req.tenantId },
        req.body,
        { new: true, runValidators: true }
      );

      if (!doc) throw new AppError('Record not found.', 404);
      res.json({ success: true, data: doc });
    } catch (err) {
      next(err);
    }
  };

  // ── TOGGLE ACTIVE ─────────────────────────────────────────────────────────
  const toggleActive = async (req, res, next) => {
    try {
      const doc = await Model.findOne({ _id: req.params.id, tenantId: req.tenantId });
      if (!doc) throw new AppError('Record not found.', 404);

      doc.isActive = !doc.isActive;
      await doc.save();

      res.json({
        success: true,
        message: `${doc.isActive ? 'Activated' : 'Deactivated'} successfully.`,
        data: { _id: doc._id, isActive: doc.isActive },
      });
    } catch (err) {
      next(err);
    }
  };

  return { list, getOne, create, update, toggleActive };
};

module.exports = masterCRUD;
