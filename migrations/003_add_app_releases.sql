-- Migration: 003_add_app_releases.sql
-- Run this script in your Supabase SQL Editor

-- 1. Create app_releases table for In-App OTA Updates
CREATE TABLE IF NOT EXISTS app_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  version_name TEXT NOT NULL,
  version_code INTEGER NOT NULL,
  min_supported_version_code INTEGER,
  apk_url TEXT NOT NULL,
  apk_size_bytes BIGINT DEFAULT 0,
  release_notes TEXT,
  is_active BOOLEAN DEFAULT true,
  is_force_update BOOLEAN DEFAULT false,
  download_count INTEGER DEFAULT 0,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Indices for fast version check and rollout queries
CREATE INDEX IF NOT EXISTS idx_app_releases_platform_active ON app_releases(platform, is_active);
CREATE INDEX IF NOT EXISTS idx_app_releases_version_code ON app_releases(platform, version_code DESC);
