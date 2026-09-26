-- Migration: Live Location Tracking & Historical Routes
-- Optimized for Render Free Tier & 100+ active employees

-- 1. Table: employee_live_locations (1 row per employee)
CREATE TABLE IF NOT EXISTS employee_live_locations (
    employee_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy DOUBLE PRECISION,
    speed DOUBLE PRECISION DEFAULT 0,
    heading DOUBLE PRECISION DEFAULT 0,
    battery_level INT,
    is_moving BOOLEAN DEFAULT false,
    is_clocked_in BOOLEAN DEFAULT true,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_loc_updated ON employee_live_locations(last_updated_at);

-- 2. Table: employee_location_history (JSONB polyline point arrays per employee per day)
CREATE TABLE IF NOT EXISTS employee_location_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    total_distance_km DOUBLE PRECISION DEFAULT 0,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    points JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, date)
);

CREATE INDEX IF NOT EXISTS idx_loc_history_emp_date ON employee_location_history(employee_id, date);

-- Enable Supabase Realtime for employee_live_locations (if publication exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE employee_live_locations;
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;
