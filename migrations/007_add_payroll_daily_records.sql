-- Migration 007: Add daily_records, earned_salary, and total_late_minutes to payroll table
ALTER TABLE payroll
  ADD COLUMN IF NOT EXISTS earned_salary NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_late_minutes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_records JSONB DEFAULT '[]'::jsonb;
