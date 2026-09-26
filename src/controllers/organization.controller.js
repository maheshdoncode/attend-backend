import { supabase } from '../db/supabase.js';

export class OrganizationController {
  /**
   * GET /api/organization/settings/lunch-tracking
   * Returns global lunch tracking configuration
   */
  static async getLunchTrackingSettings(req, res) {
    try {
      const { data, error } = await supabase
        .from('organization_settings')
        .select('value')
        .eq('key', 'lunch_tracking')
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      return res.status(200).json({
        success: true,
        settings: {
          enabled: Boolean(data?.value?.enabled ?? true),
        },
      });
    } catch (err) {
      console.error('Get lunch tracking settings error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * PUT /api/organization/settings/lunch-tracking
   * Updates global lunch tracking configuration
   */
  static async updateLunchTrackingSettings(req, res) {
    try {
      const { enabled = true } = req.body;

      const { data, error } = await supabase
        .from('organization_settings')
        .upsert(
          {
            key: 'lunch_tracking',
            value: { enabled: Boolean(enabled) },
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' }
        )
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Global lunch tracking settings updated successfully',
        settings: data.value,
      });
    } catch (err) {
      console.error('Update lunch tracking settings error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }
}
