-- Migration 011: Add flexible visibility policies, tracking, and owner controls to payroll table
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS is_visible_to_employee BOOLEAN DEFAULT false;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS visibility_mode TEXT DEFAULT 'hours';
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS visibility_hours NUMERIC(6,2) DEFAULT 24;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS first_viewed_at TIMESTAMPTZ;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;

-- Backwards compatibility: ensure historical finalized payrolls have finalized_at set
UPDATE payroll 
SET finalized_at = generated_at 
WHERE status = 'finalized' AND finalized_at IS NULL;

-- Create index for quick lookup
CREATE INDEX IF NOT EXISTS idx_payroll_visibility ON payroll(status, visibility_mode, is_visible_to_employee, finalized_at);
