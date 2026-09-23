-- Migration 006: Add early_clock_in_limit_minutes to work_schedules
ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS early_clock_in_limit_minutes INTEGER DEFAULT 30;
