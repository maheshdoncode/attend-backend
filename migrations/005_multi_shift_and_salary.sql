-- Migration 005: Multi Shift and Shift-Specific Salary
CREATE TABLE IF NOT EXISTS employee_shift_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES users(id) ON DELETE CASCADE,
  schedule_id UUID REFERENCES work_schedules(id) ON DELETE CASCADE,
  salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, schedule_id)
);

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES work_schedules(id) ON DELETE CASCADE;

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_employee_id_date_key;
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_employee_date_schedule_key;
ALTER TABLE attendance ADD CONSTRAINT attendance_employee_date_schedule_key UNIQUE (employee_id, date, schedule_id);
