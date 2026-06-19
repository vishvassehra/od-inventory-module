const mongoose = require('mongoose');
const { DEPRECIATION_METHOD } = require('../../config/constants');

const categorySchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    // Depreciation config — only relevant for asset categories
    depreciationMethod: {
      type: String,
      enum: [...Object.values(DEPRECIATION_METHOD), null],
      default: null,
    },
    depreciationRate: { type: Number, min: 0, max: 100, default: null }, // percentage per year
    usefulLifeYears: { type: Number, default: null },
    glCode: { type: String, trim: true, default: null }, // GL account code for accounting
    isAssetCategory: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

categorySchema.index({ tenantId: 1, code: 1 }, { unique: true });
categorySchema.index({ tenantId: 1, parentId: 1 });

module.exports = mongoose.model('Category', categorySchema);
