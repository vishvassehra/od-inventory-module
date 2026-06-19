/**
 * Seed Super Admin
 * Run once on fresh deploy: npm run seed:superadmin
 *
 * Reads from env vars:
 *   SA_NAME, SA_EMAIL, SA_PASSWORD
 * Falls back to defaults for local dev only.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/modules/auth/user.model');
const { ROLES } = require('../src/config/constants');

const SA_NAME = process.env.SA_NAME || 'Okie Dokie Admin';
const SA_EMAIL = process.env.SA_EMAIL || 'admin@okiedokiepay.com';
const SA_PASSWORD = process.env.SA_PASSWORD;

if (!SA_PASSWORD) {
  console.error('ERROR: SA_PASSWORD env var is required. Set it in your .env or environment.');
  process.exit(1);
}

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected');

    const existing = await User.findOne({ email: SA_EMAIL, role: ROLES.SUPER_ADMIN });
    if (existing) {
      console.log(`Super admin already exists: ${SA_EMAIL}`);
      process.exit(0);
    }

    await User.create({
      tenantId: null, // super admin is cross-tenant
      name: SA_NAME,
      email: SA_EMAIL,
      password: SA_PASSWORD,
      role: ROLES.SUPER_ADMIN,
      mustChangePassword: false,
    });

    console.log(`✓ Super admin created: ${SA_EMAIL}`);
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
};

seed();
