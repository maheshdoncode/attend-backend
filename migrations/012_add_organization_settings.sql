-- 012_add_organization_settings.sql
-- Organization Settings Table for Global Configs (including Global Payroll Visibility)

CREATE TABLE IF NOT EXISTS organization_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default global payroll visibility settings
INSERT INTO organization_settings (key, value)
VALUES ('payroll_visibility', '{"mode": "hours", "hours": 24}'::jsonb)
ON CONFLICT (key) DO NOTHING;
