const mongoose = require('mongoose');

const uomSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true }, // NOS, KG, LTR, BOX, REM
    name: { type: String, required: true, trim: true },                  // Numbers, Kilogram, Litre
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

uomSchema.index({ tenantId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('UOM', uomSchema);
