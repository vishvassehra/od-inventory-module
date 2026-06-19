const mongoose = require('mongoose');
const { INSTANCE_TYPE, INSTANCE_TIER } = require('../../config/constants');

const instanceSchema = new mongoose.Schema(
  {
    // tenantId is the canonical identifier used across ALL collections
    tenantId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9-]+$/, 'tenantId can only contain lowercase letters, numbers, and hyphens'],
    },
    name: {
      type: String,
      required: [true, 'Institution name is required'],
      trim: true,
    },
    shortName: {
      type: String,
      trim: true,
      maxlength: [20, 'Short name cannot exceed 20 characters'],
    },
    type: {
      type: String,
      enum: Object.values(INSTANCE_TYPE),
      required: true,
    },
    tier: {
      type: String,
      enum: Object.values(INSTANCE_TIER),
      default: INSTANCE_TIER.STANDARD,
    },
    // Contact & branding
    contactEmail: { type: String, lowercase: true, trim: true },
    contactPhone: { type: String, trim: true },
    address: {
      line1: String,
      city: String,
      state: String,
      pincode: String,
    },
    logoUrl: { type: String, default: null },
    // Module toggles — controls what the inst admin can access
    modules: {
      purchase: { type: Boolean, default: true },
      stock: { type: Boolean, default: true },
      assets: { type: Boolean, default: true },
      verification: { type: Boolean, default: true },
      depreciation: { type: Boolean, default: false }, // enabled on upgrade
    },
    // Financial year config
    fyStartMonth: {
      type: Number,
      default: 4, // April (Indian FY)
      min: 1,
      max: 12,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    activatedAt: {
      type: Date,
      default: Date.now,
    },
    deactivatedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    // Stats cache (updated periodically, not real-time)
    stats: {
      totalUsers: { type: Number, default: 0 },
      lastActivityAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model('Instance', instanceSchema);
