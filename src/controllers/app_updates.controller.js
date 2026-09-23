import { z } from 'zod';
import { supabase } from '../db/supabase.js';

const publishReleaseSchema = z.object({
  platform: z.enum(['android', 'ios']).default('android'),
  version_name: z.string().min(1, 'version_name is required'),
  version_code: z.number().int().positive('version_code must be a positive integer'),
  min_supported_version_code: z.number().int().positive().optional().nullable(),
  apk_url: z.string().url('apk_url must be a valid URL'),
  apk_size_bytes: z.number().int().nonnegative().optional().default(0),
  release_notes: z.string().optional().nullable(),
  is_active: z.boolean().optional().default(true),
  is_force_update: z.boolean().optional().default(false),
});

export class AppUpdatesController {
  /**
   * Check for new app updates.
   * Public or Authenticated GET /api/hrm/app-updates/check?platform=android&version_code=14
   */
  static async checkUpdate(req, res) {
    try {
      const platform = (req.query.platform || 'android').toLowerCase();
      const currentVersionCode = parseInt(req.query.version_code, 10);

      if (isNaN(currentVersionCode)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'query param version_code is required and must be an integer',
          },
        });
      }

      // Fetch the latest active release for this platform
      const { data: release, error } = await supabase
        .from('app_releases')
        .select('*')
        .eq('platform', platform)
        .eq('is_active', true)
        .order('version_code', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        if (error.code === 'PGRST205' || error.message?.includes('does not exist')) {
          return res.json({
            success: true,
            update_available: false,
            message: 'app_releases table not yet migrated in Supabase.',
          });
        }
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      if (!release || release.version_code <= currentVersionCode) {
        return res.json({
          success: true,
          update_available: false,
          current_version_code: currentVersionCode,
          latest_version_code: release?.version_code || currentVersionCode,
        });
      }

      // Check if this is a mandatory/force update
      const isForceUpdate =
        Boolean(release.is_force_update) ||
        (release.min_supported_version_code && currentVersionCode < release.min_supported_version_code);

      return res.json({
        success: true,
        update_available: true,
        is_force_update: isForceUpdate,
        latest_release: {
          id: release.id,
          platform: release.platform,
          version_name: release.version_name,
          version_code: release.version_code,
          min_supported_version_code: release.min_supported_version_code,
          apk_url: release.apk_url,
          apk_size_bytes: Number(release.apk_size_bytes || 0),
          release_notes: release.release_notes,
          published_at: release.created_at,
        },
      });
    } catch (err) {
      console.error('Error in checkUpdate:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err.message },
      });
    }
  }

  /**
   * Publish a new release or update rollout.
   * Owner only POST /api/hrm/app-updates/publish
   */
  static async publishRelease(req, res) {
    try {
      const parsed = publishReleaseSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues.map((i) => i.message).join(', '),
          },
        });
      }

      const releaseData = parsed.data;

      // If this release is active, deactivate previous active releases for the platform
      if (releaseData.is_active) {
        await supabase
          .from('app_releases')
          .update({ is_active: false })
          .eq('platform', releaseData.platform);
      }

      const insertPayload = {
        platform: releaseData.platform,
        version_name: releaseData.version_name,
        version_code: releaseData.version_code,
        min_supported_version_code: releaseData.min_supported_version_code || null,
        apk_url: releaseData.apk_url,
        apk_size_bytes: releaseData.apk_size_bytes || 0,
        release_notes: releaseData.release_notes || null,
        is_active: releaseData.is_active ?? true,
        is_force_update: releaseData.is_force_update ?? false,
        uploaded_by: req.user?.id || null,
      };

      const { data: created, error } = await supabase
        .from('app_releases')
        .insert(insertPayload)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST205' || error.message?.includes('does not exist')) {
          return res.status(500).json({
            success: false,
            error: {
              code: 'TABLE_NOT_FOUND',
              message: 'app_releases table not found. Please run migrations/003_add_app_releases.sql in Supabase SQL editor.',
            },
          });
        }
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      return res.status(201).json({
        success: true,
        message: `App release v${created.version_name} (build ${created.version_code}) published successfully`,
        data: created,
      });
    } catch (err) {
      console.error('Error in publishRelease:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err.message },
      });
    }
  }

  /**
   * List all app releases with pagination.
   * Owner only GET /api/hrm/app-updates/releases
   */
  static async listReleases(req, res) {
    try {
      const platform = req.query.platform || null;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const offset = (page - 1) * limit;

      let query = supabase
        .from('app_releases')
        .select('*, uploaded_by_user:users(id, name, email)', { count: 'exact' });

      if (platform) {
        query = query.eq('platform', platform);
      }

      query = query
        .order('version_code', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data: releases, count, error } = await query;

      if (error) {
        if (error.code === 'PGRST205' || error.message?.includes('does not exist')) {
          return res.json({
            success: true,
            data: [],
            pagination: { page, limit, total: 0, totalPages: 0 },
            message: 'app_releases table not yet created in Supabase',
          });
        }
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      const total = count || 0;
      return res.json({
        success: true,
        data: releases || [],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (err) {
      console.error('Error in listReleases:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err.message },
      });
    }
  }

  /**
   * Toggle rollout status or force update for a release.
   * Owner only PUT /api/hrm/app-updates/releases/:id/rollout
   */
  static async toggleRollout(req, res) {
    try {
      const { id } = req.params;
      const { is_active, is_force_update } = req.body;

      // Find the target release
      const { data: target, error: fetchErr } = await supabase
        .from('app_releases')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchErr || !target) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Release record not found' },
        });
      }

      // If activating, deactivate any other release for the same platform
      if (is_active === true) {
        await supabase
          .from('app_releases')
          .update({ is_active: false })
          .eq('platform', target.platform);
      }

      const updates = {};
      if (typeof is_active === 'boolean') updates.is_active = is_active;
      if (typeof is_force_update === 'boolean') updates.is_force_update = is_force_update;

      const { data: updated, error: updateErr } = await supabase
        .from('app_releases')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (updateErr) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: updateErr.message },
        });
      }

      return res.json({
        success: true,
        message: `Rollout status for v${updated.version_name} updated successfully`,
        data: updated,
      });
    } catch (err) {
      console.error('Error in toggleRollout:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err.message },
      });
    }
  }

  /**
   * Delete an old release.
   * Owner only DELETE /api/hrm/app-updates/releases/:id
   */
  static async deleteRelease(req, res) {
    try {
      const { id } = req.params;

      const { error } = await supabase
        .from('app_releases')
        .delete()
        .eq('id', id);

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      return res.json({
        success: true,
        message: 'Release record deleted successfully',
      });
    } catch (err) {
      console.error('Error in deleteRelease:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err.message },
      });
    }
  }
}

export default AppUpdatesController;
