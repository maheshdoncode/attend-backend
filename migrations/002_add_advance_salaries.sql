-- Migration: 002_add_advance_salaries.sql
-- Run this script in your Supabase SQL Editor

-- 1. Add advance_deduction column to payroll table if it doesn't already exist
ALTER TABLE IF EXISTS payroll 
ADD COLUMN IF NOT EXISTS advance_deduction NUMERIC(12,2) DEFAULT 0;

-- 2. Create advance_salaries table
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

-- 3. Create indices for fast querying and payroll generation
CREATE INDEX IF NOT EXISTS idx_advance_salaries_emp_status ON advance_salaries(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_advance_salaries_month_year ON advance_salaries(target_month, target_year);
