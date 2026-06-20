# OD Inventory Module — Production Ready

**Okie Dokie ERP · Inventory Management for Educational Institutions**

## What's Inside

```
od-inventory-module/
├── src/                          # Node.js + Express backend
│   ├── app.js                    # Entry point
│   ├── config/                   # DB, logger, constants
│   ├── middleware/               # Auth, error handler
│   └── modules/
│       ├── auth/                 # JWT auth + user management
│       ├── superadmin/           # Instance management
│       ├── masters/              # Item, Vendor, Category, Warehouse, Dept
│       ├── purchase/             # PR → PO → GRN
│       └── stock/                # SIV, Returns, Ledger, Reports
├── scripts/
│   ├── seedSuperAdmin.js         # Run once after deploy
│   └── seedMasters.js            # Seed default UOMs/categories
├── frontend/
│   └── od-inventory-frontend.html  # Complete single-file frontend
├── .env.example                  # Environment variables template
├── render.yaml                   # Render deployment config
└── package.json
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 + Express 4 |
| Database | MongoDB Atlas (Mongoose 8) |
| Auth | JWT (access + refresh), RBAC, multi-tenant |
| Frontend | Vanilla JS + HTML (zero build step) |
| Deploy | Render (backend) + GitHub Pages (frontend) |

## Quick Deploy

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "feat: initial production deploy"
git remote add origin https://github.com/YOUR_ORG/od-inventory-module.git
git push -u origin main
```

### 2. MongoDB Atlas
- Create free M0 cluster (Singapore region)
- Create DB user, allow 0.0.0.0/0 network access
- Copy connection string

### 3. Render (Backend)
- New Web Service → connect GitHub repo
- Build: `npm install` | Start: `npm start`
- Add environment variables from `.env.example`
- Deploy

### 4. Seed Super Admin (Render Shell or Atlas)
**Option A — Atlas Data Explorer** (Insert into `users` collection):
```json
{
  "tenantId": null,
  "name": "Okie Dokie Admin",
  "email": "admin@okiedokiepay.com",
  "password": "$2a$12$6sIOouf0c85W4UkZdVwy9.3wUsfMmDRr1HHHR8e5EOa3ZhX69V7Xi",
  "role": "super_admin",
  "isActive": true,
  "mustChangePassword": false,
  "lastLoginAt": null,
  "passwordChangedAt": null,
  "__v": 0
}
```
Password for above hash: **`Admin@123`**

### 5. GitHub Pages (Frontend)
- Make repo public
- Settings → Pages → main → / (root) → Save
- URL: `https://YOUR_ORG.github.io/od-inventory-module/frontend/od-inventory-frontend.html`

## API Reference

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/auth/refresh` | Refresh token |
| GET | `/api/v1/auth/me` | Current user |
| POST | `/api/v1/auth/change-password` | Change password |

### Super Admin
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/v1/superadmin/instances` | List/create institutions |
| PATCH | `/api/v1/superadmin/instances/:tid` | Update institution |
| PATCH | `/api/v1/superadmin/instances/:tid/toggle-active` | Activate/deactivate |
| POST | `/api/v1/superadmin/instances/:tid/users` | Add user to institution |

### Masters
| Method | Path |
|--------|------|
| GET/POST | `/api/v1/masters/categories` |
| GET/POST | `/api/v1/masters/uoms` |
| GET/POST | `/api/v1/masters/items` |
| GET/POST | `/api/v1/masters/vendors` |
| GET/POST | `/api/v1/masters/warehouses` |
| GET/POST | `/api/v1/masters/departments` |

### Purchase Flow
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/purchase/prs` | Create PR |
| POST | `/api/v1/purchase/prs/:id/submit` | Submit PR |
| POST | `/api/v1/purchase/prs/:id/approve` | Approve PR |
| POST | `/api/v1/purchase/pos` | Create PO |
| POST | `/api/v1/purchase/pos/:id/approve` | Approve PO |
| POST | `/api/v1/purchase/grns` | Create GRN |
| POST | `/api/v1/purchase/grns/:id/post` | Post GRN → stock |

### Stock Operations
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/stock/sivs` | Raise stock indent |
| POST | `/api/v1/stock/sivs/:id/submit` | Submit for approval |
| POST | `/api/v1/stock/sivs/:id/approve` | Approve indent |
| POST | `/api/v1/stock/sivs/:id/issue` | Issue stock |
| POST | `/api/v1/stock/returns` | Return to store |
| POST | `/api/v1/stock/opening` | Post opening stock |
| GET | `/api/v1/stock/summary` | Current stock |
| GET | `/api/v1/stock/ledger?itemId=X` | Movement register |
| GET | `/api/v1/stock/low-stock` | Below reorder |

### Users
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/users` | List users |
| POST | `/api/v1/users` | Create user |
| PATCH | `/api/v1/users/:id` | Update user |
| PATCH | `/api/v1/users/:id/reset-password` | Reset password |
| PATCH | `/api/v1/users/:id/toggle-active` | Activate/deactivate |

## Frontend Pages

| Page | Route | Who |
|------|-------|-----|
| Login | / | All |
| Institutions | Super Admin | SA only |
| Dashboard | Home | All inst roles |
| Item Master | Masters | Admin, PO, SM |
| Vendors | Masters | Admin, PO, SM |
| Categories | Masters | Admin, PO, SM |
| Warehouses | Masters | Admin, SM |
| Departments | Masters | Admin |
| Purchase Requisitions | Purchase | All |
| Purchase Orders | Purchase | Admin, PO |
| GRN | Purchase | Admin, SM |
| Stock Summary | Stock | Admin, PO, SM |
| Stock Indents | Stock | All |
| Stock Returns | Stock | Admin, SM |
| Stock Ledger | Stock | Admin, PO, SM |
| Low Stock Alerts | Stock | Admin, PO, SM |
| Users | Admin | Admin |

## Roles

| Role | Code | Capabilities |
|------|------|-------------|
| Super Admin | `super_admin` | Cross-tenant, manage all institutions |
| Institution Admin | `inst_admin` | Full access within their institution |
| Purchase Officer | `purchase_officer` | PR, PO, GRN, Masters |
| Store Manager | `store_manager` | GRN, SIV issue, Returns, Stock |
| HOD | `hod` | Approve PR/SIV for their department |
| Department Staff | `dept_staff` | Raise PR/SIV, view own dept |

## Default Credentials (after seeding)

| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@okiedokiepay.com | Admin@123 |
| Inst Admin | (set at institution creation) | (set at creation) |

---
*Built by Okie Dokie Solutions · okiedokie.com*
