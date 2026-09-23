-- Migration: Add schedule_id to deduction_policies table
ALTER TABLE deduction_policies ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES work_schedules(id) ON DELETE CASCADE;
