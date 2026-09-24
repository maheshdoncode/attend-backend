-- Migration 010: Database Indexes for High-Performance Queries & Payroll Acceleration
-- Run this in Supabase SQL editor

CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role, is_active);
CREATE INDEX IF NOT EXISTS idx_emp_profiles_user_id ON employee_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_emp_profiles_code ON employee_profiles(employee_code);
CREATE INDEX IF NOT EXISTS idx_emp_shift_assignments_emp_id ON employee_shift_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_shift_assignments_schedule_id ON employee_shift_assignments(schedule_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date_range ON attendance(date, employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date_sched ON attendance(employee_id, date, schedule_id);
CREATE INDEX IF NOT EXISTS idx_holidays_branch_date ON holidays(branch_id, date);
CREATE INDEX IF NOT EXISTS idx_working_days_emp_date ON working_days_overrides(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_advance_salaries_emp_month_year ON advance_salaries(employee_id, target_month, target_year, status);
CREATE INDEX IF NOT EXISTS idx_deduction_policies_active ON deduction_policies(is_active, condition_type);
