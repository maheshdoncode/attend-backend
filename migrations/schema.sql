-- Attendy HRMS Database Schema
-- Run this script in the Supabase SQL editor

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  current_password TEXT,
  role TEXT CHECK (role IN ('owner','branch_manager','employee')) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Migration for existing installations:
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_password TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE deduction_policies ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES work_schedules(id) ON DELETE CASCADE;

-- 2. Branches Table
CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  radius_meters INTEGER DEFAULT 100,
  qr_secret TEXT NOT NULL,
  qr_type TEXT CHECK (qr_type IN ('static','dynamic')) DEFAULT 'static',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Employee Profiles Table
CREATE TABLE IF NOT EXISTS employee_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  employee_code TEXT UNIQUE,
  department TEXT,
  phone_number TEXT,
  monthly_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  joined_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Branch Managers Table
CREATE TABLE IF NOT EXISTS branch_managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  UNIQUE(user_id, branch_id)
);

-- 5. Branch Employee Assignments Table
CREATE TABLE IF NOT EXISTS branch_employee_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES users(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, branch_id)
);

-- 6. Work Schedules Table
CREATE TABLE IF NOT EXISTS work_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Employee Schedule Overrides Table
CREATE TABLE IF NOT EXISTS employee_schedule_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  schedule_id UUID REFERENCES work_schedules(id) ON DELETE CASCADE
);

-- 8. Holidays Table
CREATE TABLE IF NOT EXISTS holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  name TEXT NOT NULL,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 9. Deduction Policies Table
CREATE TABLE IF NOT EXISTS deduction_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  condition_type TEXT CHECK (condition_type IN ('late_arrival','absent','half_day','early_departure')) NOT NULL,
  threshold_minutes INTEGER,
  deduction_type TEXT CHECK (deduction_type IN ('fixed_minutes','half_day','full_day')) DEFAULT 'fixed_minutes',
  deduction_minutes INTEGER,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 10. Attendance Table
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES users(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  date DATE NOT NULL,
  clock_in_time TIMESTAMPTZ,
  clock_in_lat DOUBLE PRECISION,
  clock_in_lng DOUBLE PRECISION,
  clock_out_time TIMESTAMPTZ,
  clock_out_lat DOUBLE PRECISION,
  clock_out_lng DOUBLE PRECISION,
  status TEXT CHECK (status IN ('present','late','half_day','absent','holiday')) DEFAULT 'present',
  is_flagged BOOLEAN DEFAULT false,
  flag_reason TEXT,
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, date)
);

-- 11. Payroll Table
CREATE TABLE IF NOT EXISTS payroll (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES users(id) ON DELETE CASCADE,
  month INTEGER CHECK (month BETWEEN 1 AND 12) NOT NULL,
  year INTEGER NOT NULL,
  working_days INTEGER,
  present_days INTEGER,
  absent_days INTEGER,
  late_count INTEGER,
  half_day_count INTEGER,
  total_deduction_amount NUMERIC(12,2) DEFAULT 0,
  advance_deduction NUMERIC(12,2) DEFAULT 0,
  deduction_breakdown JSONB,
  gross_salary NUMERIC(12,2),
  net_salary NUMERIC(12,2),
  status TEXT CHECK (status IN ('draft','finalized')) DEFAULT 'draft',
  finalized_at TIMESTAMPTZ,
  is_visible_to_employee BOOLEAN DEFAULT false,
  visibility_mode TEXT CHECK (visibility_mode IN ('hours', 'once', 'always', 'hidden')) DEFAULT 'hours',
  visibility_hours NUMERIC(6,2) DEFAULT 24,
  view_count INTEGER DEFAULT 0,
  first_viewed_at TIMESTAMPTZ,
  last_viewed_at TIMESTAMPTZ,
  generated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, month, year)
);

-- 12. Working Days Overrides Table (e.g. Working Sundays)
CREATE TABLE IF NOT EXISTS working_days_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 13. Advance Salaries Table
CREATE TABLE IF NOT EXISTS advance_salaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason TEXT,
  target_month INTEGER CHECK (target_month BETWEEN 1 AND 12),
  target_year INTEGER,
  status TEXT CHECK (status IN ('pending', 'approved', 'rejected', 'deducted')) DEFAULT 'pending',
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  payroll_id UUID REFERENCES payroll(id) ON DELETE SET NULL,
  deducted_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 14. App Releases Table (In-App OTA Updates)
CREATE TABLE IF NOT EXISTS app_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  version_name TEXT NOT NULL,
  version_code INTEGER NOT NULL,
  min_supported_version_code INTEGER,
  apk_url TEXT NOT NULL,
  apk_size_bytes BIGINT DEFAULT 0,
  release_notes TEXT,
  is_active BOOLEAN DEFAULT true,
  is_force_update BOOLEAN DEFAULT false,
  download_count INTEGER DEFAULT 0,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_branch_date ON attendance(branch_id, date);
CREATE INDEX IF NOT EXISTS idx_payroll_emp_month_year ON payroll(employee_id, month, year);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
CREATE INDEX IF NOT EXISTS idx_branch_emp_branch_id ON branch_employee_assignments(branch_id);
CREATE INDEX IF NOT EXISTS idx_working_days_date ON working_days_overrides(date);
CREATE INDEX IF NOT EXISTS idx_advance_salaries_emp_status ON advance_salaries(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_advance_salaries_month_year ON advance_salaries(target_month, target_year);
CREATE INDEX IF NOT EXISTS idx_app_releases_platform_active ON app_releases(platform, is_active);
CREATE INDEX IF NOT EXISTS idx_app_releases_version_code ON app_releases(platform, version_code DESC);

-- 15. Organization Settings Table
CREATE TABLE IF NOT EXISTS organization_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed Initial Deduction Policies if not already present
INSERT INTO deduction_policies (name, condition_type, threshold_minutes, deduction_type, deduction_minutes, is_active)
SELECT 'Late Arrival', 'late_arrival', 10, 'fixed_minutes', 30, true
WHERE NOT EXISTS (SELECT 1 FROM deduction_policies WHERE condition_type = 'late_arrival' AND name = 'Late Arrival');

INSERT INTO deduction_policies (name, condition_type, threshold_minutes, deduction_type, deduction_minutes, is_active)
SELECT 'Absent', 'absent', NULL, 'full_day', NULL, true
WHERE NOT EXISTS (SELECT 1 FROM deduction_policies WHERE condition_type = 'absent' AND name = 'Absent');

INSERT INTO deduction_policies (name, condition_type, threshold_minutes, deduction_type, deduction_minutes, is_active)
SELECT 'Half Day', 'half_day', NULL, 'half_day', NULL, true
WHERE NOT EXISTS (SELECT 1 FROM deduction_policies WHERE condition_type = 'half_day' AND name = 'Half Day');

-- Seed Default Work Schedule if not already present
INSERT INTO work_schedules (name, start_time, end_time, is_default)
SELECT 'General Shift', '09:00:00', '18:00:00', true
WHERE NOT EXISTS (SELECT 1 FROM work_schedules WHERE is_default = true);

-- Seed Default Organization Settings
INSERT INTO organization_settings (key, value)
VALUES ('payroll_visibility', '{"mode": "hours", "hours": 24}'::jsonb)
ON CONFLICT (key) DO NOTHING;

