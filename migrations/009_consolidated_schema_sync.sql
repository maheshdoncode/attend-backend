-- Run this in Supabase SQL Editor to make sure all work_schedules and payroll columns exist:

-- 1. Add break times and early clock in limit to work_schedules
ALTER TABLE work_schedules
  ADD COLUMN IF NOT EXISTS early_clock_in_limit_minutes INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS has_break BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS break_start_time TIME WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS break_end_time TIME WITHOUT TIME ZONE;

-- 2. Add earned_salary, total_late_minutes, and daily_records to payroll
ALTER TABLE payroll
  ADD COLUMN IF NOT EXISTS earned_salary NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_late_minutes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_records JSONB DEFAULT '[]'::jsonb;
