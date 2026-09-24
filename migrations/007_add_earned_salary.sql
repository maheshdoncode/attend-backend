-- Migration 007: Add earned_salary column to payroll table
-- earned_salary = sum of daily rates for shifts where employee was present (full or half day)
-- net_salary = earned_salary - late_penalties - advance_deductions (computed by payroll service)

ALTER TABLE payroll
  ADD COLUMN IF NOT EXISTS earned_salary NUMERIC(12,2) DEFAULT 0;
