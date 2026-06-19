// ── User Roles ───────────────────────────────────────────────────────────────
const ROLES = {
  SUPER_ADMIN: 'super_admin',        // Okie Dokie team — cross-tenant
  INST_ADMIN: 'inst_admin',          // Institution administrator
  PURCHASE_OFFICER: 'purchase_officer',
  STORE_MANAGER: 'store_manager',
  HOD: 'hod',                        // Head of Department — approver
  DEPT_STAFF: 'dept_staff',          // Raises indents, views own dept
};

// ── Approval Status (shared across PR / PO / Indent) ────────────────────────
const APPROVAL_STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
};

// ── PO Status ────────────────────────────────────────────────────────────────
const PO_STATUS = {
  DRAFT: 'draft',
  SENT: 'sent',
  CONFIRMED: 'confirmed',
  PARTIAL: 'partial',
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
};

// ── GRN Status ───────────────────────────────────────────────────────────────
const GRN_STATUS = {
  DRAFT: 'draft',
  POSTED: 'posted',
  PARTIAL: 'partial',
};

// ── Stock Ledger Transaction Types ───────────────────────────────────────────
const LEDGER_TXN_TYPE = {
  OPENING: 'opening',           // Opening stock entry (migration)
  GRN: 'grn',                   // Goods received
  ISSUE: 'issue',               // Stock issued to dept
  RETURN: 'return',             // Stock returned from dept
  TRANSFER_OUT: 'transfer_out', // Inter-warehouse transfer out
  TRANSFER_IN: 'transfer_in',   // Inter-warehouse transfer in
  ADJUSTMENT_ADD: 'adj_add',    // Verification surplus
  ADJUSTMENT_SUB: 'adj_sub',    // Verification shortage write-off
  REVERSAL: 'reversal',         // Reversal of a wrong entry
};

// ── Asset Status ─────────────────────────────────────────────────────────────
const ASSET_STATUS = {
  IN_STORE: 'in_store',
  ASSIGNED: 'assigned',
  UNDER_REPAIR: 'under_repair',
  CONDEMNED: 'condemned',
  DISPOSED: 'disposed',
};

// ── Asset Movement Types ─────────────────────────────────────────────────────
const ASSET_MOVEMENT_TYPE = {
  INITIAL_ASSIGNMENT: 'initial_assignment',
  TRANSFER: 'transfer',
  RETURN_TO_STORE: 'return_to_store',
  SENT_FOR_REPAIR: 'sent_for_repair',
  RETURNED_FROM_REPAIR: 'returned_from_repair',
  CONDEMNED: 'condemned',
  DISPOSED: 'disposed',
};

// ── Depreciation Methods ─────────────────────────────────────────────────────
const DEPRECIATION_METHOD = {
  SLM: 'slm',   // Straight Line Method
  WDV: 'wdv',   // Written Down Value
};

// ── Condemnation Disposal Methods ────────────────────────────────────────────
const DISPOSAL_METHOD = {
  AUCTION: 'auction',
  SCRAP: 'scrap',
  DONATED: 'donated',
  DESTROYED: 'destroyed',
};

// ── Verification Status (per asset/item in a verification cycle) ─────────────
const VERIFICATION_ITEM_STATUS = {
  PENDING: 'pending',
  FOUND_OK: 'found_ok',
  FOUND_DAMAGED: 'found_damaged',
  NOT_FOUND: 'not_found',
};

// ── Instance Types ───────────────────────────────────────────────────────────
const INSTANCE_TYPE = {
  SCHOOL: 'school',
  COLLEGE: 'college',
  UNIVERSITY: 'university',
};

// ── Instance Tiers ───────────────────────────────────────────────────────────
const INSTANCE_TIER = {
  BASIC: 'basic',
  STANDARD: 'standard',
};

module.exports = {
  ROLES,
  APPROVAL_STATUS,
  PO_STATUS,
  GRN_STATUS,
  LEDGER_TXN_TYPE,
  ASSET_STATUS,
  ASSET_MOVEMENT_TYPE,
  DEPRECIATION_METHOD,
  DISPOSAL_METHOD,
  VERIFICATION_ITEM_STATUS,
  INSTANCE_TYPE,
  INSTANCE_TIER,
};
