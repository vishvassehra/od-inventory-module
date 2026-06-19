const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    // Tax identifiers
    gstin: { type: String, trim: true, uppercase: true, default: null },
    pan: { type: String, trim: true, uppercase: true, default: null },
    // Contact
    contactPerson: { type: String, trim: true, default: null },
    email: { type: String, trim: true, lowercase: true, default: null },
    phone: { type: String, trim: true, default: null },
    // Address
    address: {
      line1: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, trim: true },
    },
    // Bank details (for payment reference)
    bankDetails: {
      accountName: { type: String, trim: true },
      accountNo: { type: String, trim: true },
      ifsc: { type: String, trim: true, uppercase: true },
      bankName: { type: String, trim: true },
    },
    // Rating (1-5, updated manually after each GRN quality check)
    rating: { type: Number, min: 1, max: 5, default: null },
    isBlacklisted: { type: Boolean, default: false },
    blacklistReason: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

vendorSchema.index({ tenantId: 1, code: 1 }, { unique: true });
vendorSchema.index({ tenantId: 1, gstin: 1 }, { sparse: true });

module.exports = mongoose.model('Vendor', vendorSchema);
