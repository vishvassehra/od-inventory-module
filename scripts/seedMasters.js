/**
 * Seed default masters for a new institution instance.
 * Run: node scripts/seedMasters.js <tenantId>
 *
 * Seeds: UOMs, common categories, default warehouse
 * Safe to run multiple times — skips existing records.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const UOM = require('../src/modules/masters/uom.model');
const Category = require('../src/modules/masters/category.model');
const Warehouse = require('../src/modules/masters/warehouse.model');

const tenantId = process.argv[2];
if (!tenantId) {
  console.error('Usage: node scripts/seedMasters.js <tenantId>');
  process.exit(1);
}

const DEFAULT_UOMS = [
  { code: 'NOS', name: 'Numbers' },
  { code: 'KG', name: 'Kilogram' },
  { code: 'LTR', name: 'Litre' },
  { code: 'BOX', name: 'Box' },
  { code: 'REM', name: 'Ream' },
  { code: 'MTR', name: 'Metre' },
  { code: 'PKT', name: 'Packet' },
  { code: 'SET', name: 'Set' },
  { code: 'PRS', name: 'Pairs' },
  { code: 'BTL', name: 'Bottle' },
];

const DEFAULT_CATEGORIES = [
  { code: 'FURN', name: 'Furniture', isAssetCategory: true, depreciationMethod: 'slm', depreciationRate: 10, usefulLifeYears: 10 },
  { code: 'ELEC', name: 'Electronics', isAssetCategory: true, depreciationMethod: 'wdv', depreciationRate: 40, usefulLifeYears: 5 },
  { code: 'COMP', name: 'Computers & IT Equipment', isAssetCategory: true, depreciationMethod: 'wdv', depreciationRate: 40, usefulLifeYears: 5 },
  { code: 'VEHI', name: 'Vehicles', isAssetCategory: true, depreciationMethod: 'wdv', depreciationRate: 15, usefulLifeYears: 10 },
  { code: 'STAT', name: 'Stationery', isAssetCategory: false },
  { code: 'CHEM', name: 'Chemicals & Lab Supplies', isAssetCategory: false },
  { code: 'SPRT', name: 'Sports Equipment', isAssetCategory: false },
  { code: 'CLEAN', name: 'Cleaning Supplies', isAssetCategory: false },
  { code: 'PRINT', name: 'Printing & Toner', isAssetCategory: false },
  { code: 'ELECCON', name: 'Electrical Consumables', isAssetCategory: false },
];

const seed = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Seeding masters for tenant: ${tenantId}`);

  // UOMs
  let uomCount = 0;
  for (const uom of DEFAULT_UOMS) {
    const exists = await UOM.findOne({ tenantId, code: uom.code });
    if (!exists) {
      await UOM.create({ ...uom, tenantId });
      uomCount++;
    }
  }
  console.log(`✓ UOMs: ${uomCount} created (${DEFAULT_UOMS.length - uomCount} already existed)`);

  // Categories
  let catCount = 0;
  for (const cat of DEFAULT_CATEGORIES) {
    const exists = await Category.findOne({ tenantId, code: cat.code });
    if (!exists) {
      await Category.create({ ...cat, tenantId });
      catCount++;
    }
  }
  console.log(`✓ Categories: ${catCount} created (${DEFAULT_CATEGORIES.length - catCount} already existed)`);

  // Default warehouse
  const whExists = await Warehouse.findOne({ tenantId, code: 'MAIN' });
  if (!whExists) {
    await Warehouse.create({ tenantId, code: 'MAIN', name: 'Main Store', type: 'main' });
    console.log('✓ Default warehouse created: MAIN');
  } else {
    console.log('✓ Default warehouse already exists');
  }

  console.log(`\nSeeding complete for ${tenantId}`);
  process.exit(0);
};

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
