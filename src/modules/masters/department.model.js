const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    hodUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,  // set after users are created
    },
    parentDeptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      default: null,  // supports sub-departments
    },
    costCentre: { type: String, trim: true, default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

departmentSchema.index({ tenantId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('Department', departmentSchema);
