-- Migration 008: Add break times to work_schedules
ALTER TABLE work_schedules
  ADD COLUMN IF NOT EXISTS has_break BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS break_start_time TIME WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS break_end_time TIME WITHOUT TIME ZONE;
