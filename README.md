# Attendy HRMS REST API Backend

Production-ready Node.js & Express REST API for **Attendy HRMS** with Supabase PostgreSQL, custom JWT role-based authentication, QR code check-in/out with geofencing, multi-branch management, dynamic deduction policies, automated payroll generation, and PDF/Excel reports.

---

## 🛠️ Tech Stack & Libraries
- **Runtime & Framework**: Node.js, Express.js (ES Modules)
- **Database**: Supabase PostgreSQL (`@supabase/supabase-js` with service role key)
- **Authentication**: `jsonwebtoken` (custom JWT auth), `bcryptjs` (password hashing)
- **QR & Geolocation**: `qrcode` (Base64 PNG generation), `geolib` (Haversine distance calculation)
- **Exports & Reporting**: `exceljs` (Excel sheets), `pdfkit` (PDF payslips and reports)
- **Validation & Security**: `zod`, `helmet`, `cors`, `express-rate-limit`

---

## 📁 Directory Structure
```
migrations/
  └── schema.sql              # Supabase PostgreSQL tables, constraints, indices & seeds
src/
  ├── db/
  │   └── supabase.js         # Supabase client initialization
  ├── middleware/
  │   ├── auth.js             # Bearer JWT verification
  │   ├── requireRole.js      # Role-based access control (owner, branch_manager, employee)
  │   ├── branchScope.js      # Scopes branch_manager queries to authorized branches
  │   └── validate.js         # Zod schema validation middleware
  ├── services/
  │   ├── attendance.service.js  # Clock-in/out, geofence, QR validation & auto-flag cron
  │   └── payroll.service.js     # Payroll calculations, shift minutes & policy deductions
  ├── utils/
  │   ├── geo.js              # Haversine distance & radius calculations
  │   ├── qr.js               # Static/dynamic QR payload generator, validator & image builder
  │   ├── schedule.js         # Schedule overrides, late calculations & holiday checks
  │   └── export.js           # Excel workbook & PDF document generators
  ├── controllers/
  │   ├── auth.controller.js
  │   ├── employees.controller.js
  │   ├── branches.controller.js
  │   ├── attendance.controller.js
  │   ├── schedules.controller.js
  │   ├── holidays.controller.js
  │   ├── policies.controller.js
  │   ├── payroll.controller.js
  │   └── reports.controller.js
  ├── routes/
  │   ├── index.js            # Aggregates all routes under /api/hrm/*
  │   ├── auth.routes.js
  │   ├── employees.routes.js
  │   ├── branches.routes.js
  │   ├── attendance.routes.js
  │   ├── schedules.routes.js
  │   ├── holidays.routes.js
  │   ├── policies.routes.js
  │   ├── payroll.routes.js
  │   └── reports.routes.js
  └── server.js               # Express application configuration and security
index.js                      # Root entry point
```

---

## ⚙️ Environment Variables (`.env`)
Create a `.env` file in the root directory (or copy from `.env.example`):

```env
PORT=8000
NODE_ENV=development
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
JWT_SECRET=your-super-secret-jwt-key
CRON_SECRET=your-secure-internal-cron-secret
```

---

## 🚀 Database Setup
Run the SQL script in [`migrations/schema.sql`](file:///Users/dhruv/Desktop/BAPA%27S/Attendy-backend/migrations/schema.sql) in your Supabase SQL Editor. It will create all 11 tables, relationships, indices, and default seed policies.

## 🔑 Default Owner / Admin Credentials

After running migrations and seeding:
- **Email:** `owner@attendy.com`
- **Password:** `password123`
- **Role:** `owner`

To re-seed or create the default owner account at any time:
```bash
npm run seed
```

---

## 📡 API Endpoints Overview

All routes are prefixed with `/api/hrm`.

### 1. Authentication
- `POST /api/hrm/auth/login` — Login with email/password, returns JWT token with branch scopes
- `GET /api/hrm/auth/me` — Get current logged-in user profile

### 2. Employee Management
- `POST /api/hrm/employees` `[owner, branch_manager]` — Create employee/manager with profile and branch assignments
- `GET /api/hrm/employees` `[owner, branch_manager]` — List employees (filtered/scoped)
- `GET /api/hrm/employees/:id` `[owner, branch_manager]` — Employee details with schedule override
- `PUT /api/hrm/employees/:id` `[owner, branch_manager]` — Update employee details and assignments
- `DELETE /api/hrm/employees/:id` `[owner]` — Soft-delete employee (`is_active = false`)
- `POST /api/hrm/employees/:id/schedule` `[owner, branch_manager]` — Assign schedule override
- `DELETE /api/hrm/employees/:id/schedule` `[owner]` — Revert to default schedule

### 3. Branch Management & QR Codes
- `POST /api/hrm/branches` `[owner]` — Create new branch with auto-generated 32-char QR secret
- `GET /api/hrm/branches` `[owner, branch_manager]` — List branches
- `GET /api/hrm/branches/:id` `[owner, branch_manager]` — Get branch by ID
- `PUT /api/hrm/branches/:id` `[owner]` — Update branch coordinates, radius, or QR mode
- `DELETE /api/hrm/branches/:id` `[owner]` — Soft delete branch
- `GET /api/hrm/branches/:id/qr` `[owner, branch_manager]` — Get base64 PNG QR code
- `POST /api/hrm/branches/:id/qr/regenerate` `[owner, branch_manager]` — Regenerate QR secret

### 4. Attendance & Check-in/out
- `POST /api/hrm/attendance/clock-in` `[employee]` — Scan QR & verify GPS radius, compute punctuality
- `POST /api/hrm/attendance/clock-out` `[employee]` — Scan QR & verify GPS radius, close shift
- `GET /api/hrm/attendance` `[owner, branch_manager]` — Paginated attendance records
- `GET /api/hrm/attendance/daily-status` `[owner, branch_manager]` — All employees roster with presence status for today or any date
- `GET /api/hrm/attendance/my` `[employee]` — View own attendance
- `PUT /api/hrm/attendance/:id/resolve` `[owner, branch_manager]` — Resolve flagged/missing attendance
- `POST /api/hrm/attendance/manual` `[owner, branch_manager]` — Manually punch clock-in/clock-out for any employee
- `POST /api/hrm/attendance/auto-flag` `[Cron Secret Header]` — Daily job to flag missing clock-outs & mark absent

### 5. Work Schedules & Shifts
- `POST /api/hrm/schedules` `[owner]` — Create work schedule
- `GET /api/hrm/schedules` `[owner, branch_manager]` — List work schedules
- `PUT /api/hrm/schedules/:id` `[owner]` — Update schedule
- `DELETE /api/hrm/schedules/:id` `[owner]` — Delete schedule

### 6. Holidays
- `POST /api/hrm/holidays` `[owner, branch_manager]` — Add branch or global holiday
- `GET /api/hrm/holidays` `[All authenticated]` — List holidays
- `DELETE /api/hrm/holidays/:id` `[owner, branch_manager]` — Remove holiday

### 7. Deduction Policies
- `POST /api/hrm/policies` `[owner]` — Add deduction policy
- `GET /api/hrm/policies` `[owner, branch_manager]` — List active policies
- `PUT /api/hrm/policies/:id` `[owner]` — Update deduction policy
- `DELETE /api/hrm/policies/:id` `[owner]` — Soft-delete policy

### 8. Payroll
- `GET /api/hrm/payroll/live` `[owner, branch_manager, employee]` — Real-time live payroll & day-by-day attendance dashboard
- `POST /api/hrm/payroll/generate` `[owner]` — Compute batch payroll with dynamic deduction policies
- `GET /api/hrm/payroll` `[owner, branch_manager, employee]` — List payroll records (employees auto-scoped to own records)
- `GET /api/hrm/payroll/:employee_id/:month/:year` `[owner, branch_manager, employee (own)]` — Payslip breakdown
- `PUT /api/hrm/payroll/:id/finalize` `[owner]` — Finalize payroll records

### 9. Reports & Exports
- `GET /api/hrm/reports/attendance` `[owner, branch_manager]` — Monthly attendance matrix
- `GET /api/hrm/reports/payroll` `[owner, branch_manager]` — Summary & totals
- `GET /api/hrm/reports/export?type=attendance&format=excel` — Stream `.xlsx` spreadsheet
- `GET /api/hrm/reports/export?type=payroll&format=pdf` — Stream `.pdf` summary document

---

## 🏃 Running the Application

```bash
# Start in development mode (hot reloading)
npm run dev

# Start in production mode
npm start
```
