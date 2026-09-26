-- Migration 013: Add Lunch Time Clock In/Out (Break Tracking) to Attendance, Branches, and Users
ALTER TABLE attendance 
  ADD COLUMN IF NOT EXISTS lunch_start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lunch_start_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lunch_start_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lunch_end_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lunch_end_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lunch_end_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lunch_duration_minutes INTEGER;

-- Add lunch tracking mode to branches ('inherit', 'enabled', 'disabled')
ALTER TABLE branches 
  ADD COLUMN IF NOT EXISTS lunch_tracking_mode TEXT DEFAULT 'inherit';

-- Add lunch tracking mode to users ('inherit', 'enabled', 'disabled')
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS lunch_tracking_mode TEXT DEFAULT 'inherit';

-- Seed default global lunch tracking settings in organization_settings
INSERT INTO organization_settings (key, value)
VALUES ('lunch_tracking', '{"enabled": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Create index for faster querying of active breaks/lunches
CREATE INDEX IF NOT EXISTS idx_attendance_lunch ON attendance(employee_id, date, lunch_start_time, lunch_end_time);
