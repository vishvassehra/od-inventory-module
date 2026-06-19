# OD Inventory Module

Production-ready inventory module for Okie Dokie ERP — serving schools, colleges, and universities.

## Stack
- **Runtime**: Node.js 20 + Express 4
- **Database**: MongoDB Atlas (Mongoose 8)
- **Auth**: JWT (access + refresh tokens), RBAC, tenantId-based multi-tenancy
- **Deploy**: Render (Singapore region) + GitHub Actions CI

---

## Quick Start (Local)

```bash
# 1. Clone & install
git clone https://github.com/okiedokie/od-inventory-module.git
cd od-inventory-module
npm install

# 2. Environment
cp .env.example .env
# Fill in MONGODB_URI, JWT_SECRET, JWT_REFRESH_SECRET, SA_PASSWORD

# 3. Seed super admin (run once)
npm run seed:superadmin

# 4. Start dev server
npm run dev
# → http://localhost:5000
# → GET /health to verify
```

---

## Project Structure

```
src/
├── app.js                    # Express app entry point
├── config/
│   ├── db.js                 # MongoDB connection with retry
│   ├── logger.js             # Winston logger
│   └── constants.js          # Roles, enums, status values
├── middleware/
│   ├── auth.js               # protect · tenantGuard · roleGuard · moduleGuard
│   └── errorHandler.js       # Global error handler + AppError class
└── modules/
    ├── auth/
    │   ├── user.model.js     # User schema (tenantId, role, password)
    │   ├── auth.controller.js
    │   └── auth.routes.js
    ├── superadmin/
    │   ├── instance.model.js # Institution instance schema
    │   ├── superadmin.controller.js
    │   └── superadmin.routes.js
    ├── masters/              # Phase 1-B: Item, Warehouse, Dept, Vendor, Category
    ├── purchase/             # Phase 1-C: PR → PO → GRN
    └── stock/                # Phase 1-D: Issue, Return, Ledger
scripts/
└── seedSuperAdmin.js
```

---

## Multi-Tenancy Design

- Every collection (except `instances` and `users` with `role: super_admin`) carries a `tenantId` field.
- `tenantId` is a slug generated from the institution name (e.g. `stmarks-001`, `piet-2025`).
- The `tenantGuard` middleware validates the JWT, resolves `tenantId`, and attaches it to `req.tenantId`.
- All database queries in business modules must include `{ tenantId: req.tenantId }` — enforced by code review.
- Super admin (`role: super_admin`) has `tenantId: null` and bypasses tenant checks.

---

## API Routes

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/login` | Login (any role) |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| GET | `/api/v1/auth/me` | Current user profile |
| POST | `/api/v1/auth/change-password` | Change password |

### Super Admin
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/superadmin/instances` | List all instances |
| POST | `/api/v1/superadmin/instances` | Create instance + first inst admin |
| GET | `/api/v1/superadmin/instances/:tenantId` | Get instance detail |
| PATCH | `/api/v1/superadmin/instances/:tenantId` | Update instance config |
| PATCH | `/api/v1/superadmin/instances/:tenantId/toggle-active` | Activate/deactivate |
| POST | `/api/v1/superadmin/instances/:tenantId/users` | Add user to instance |

---

## GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `MONGODB_URI_TEST` | Atlas URI for test DB (CI) |
| `RENDER_DEPLOY_HOOK_STAGING` | Render deploy hook URL (develop branch) |
| `RENDER_DEPLOY_HOOK_PRODUCTION` | Render deploy hook URL (main branch) |

---

## Render Environment Variables (set in dashboard)

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | Atlas production connection string |
| `JWT_SECRET` | 64-byte hex random string |
| `JWT_REFRESH_SECRET` | Different 64-byte hex random string |
| `ALLOWED_ORIGINS` | Comma-separated frontend URLs |
| `SA_EMAIL` | Super admin email |
| `SA_PASSWORD` | Super admin initial password |

Generate secrets:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Branching Strategy

```
main         → production (Render prod)
develop      → staging (Render staging)
feature/*    → PR into develop
hotfix/*     → PR into main + backmerge to develop
```
