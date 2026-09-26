-- Migration 014: Add Manual Edit Tracking and Snapshot to Payroll Table
ALTER TABLE payroll
  ADD COLUMN IF NOT EXISTS is_manually_edited BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS edited_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_calculated_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT;

-- Comment on columns
COMMENT ON COLUMN payroll.is_manually_edited IS 'True if the draft payroll figures were modified by an owner';
COMMENT ON COLUMN payroll.edited_by IS 'User ID of the owner who made the latest manual edits';
COMMENT ON COLUMN payroll.edited_at IS 'Timestamp when the manual edits were saved';
COMMENT ON COLUMN payroll.auto_calculated_snapshot IS 'Original attendance-calculated figures snapshot for 1-click reset';
COMMENT ON COLUMN payroll.admin_notes IS 'Optional owner notes on manual adjustments';
