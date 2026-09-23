import { supabase } from '../db/supabase.js';

export class PoliciesController {
  /**
   * POST /api/hrm/policies
   * Accessible by: owner
   */
  static async create(req, res) {
    try {
      const {
        name,
        condition_type,
        threshold_minutes = null,
        deduction_type = 'fixed_minutes',
        deduction_minutes = null,
        schedule_id = null,
      } = req.body;

      if (!name || !condition_type) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Name and condition_type are required',
          },
        });
      }

      const validConditions = ['late_arrival', 'absent', 'half_day', 'early_departure'];
      if (!validConditions.includes(condition_type)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_CONDITION_TYPE',
            message: `Condition type must be one of: ${validConditions.join(', ')}`,
          },
        });
      }

      const { data: policy, error } = await supabase
        .from('deduction_policies')
        .insert({
          name,
          condition_type,
          threshold_minutes: threshold_minutes !== null ? Number(threshold_minutes) : null,
          deduction_type,
          deduction_minutes: deduction_minutes !== null ? Number(deduction_minutes) : null,
          schedule_id: schedule_id || null,
          is_active: true,
        })
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      return res.status(201).json({
        success: true,
        policy,
      });
    } catch (err) {
      console.error('Create policy error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/policies
   * Accessible by: owner, branch_manager
   */
  static async list(req, res) {
    try {
      const { data: policies, error } = await supabase
        .from('deduction_policies')
        .select('*, work_schedules(id, name, start_time, end_time)')
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      return res.status(200).json({
        success: true,
        policies: policies || [],
      });
    } catch (err) {
      console.error('List policies error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * PUT /api/hrm/policies/:id
   * Accessible by: owner
   */
  static async update(req, res) {
    try {
      const { id } = req.params;
      const {
        name,
        condition_type,
        threshold_minutes,
        deduction_type,
        deduction_minutes,
        is_active,
      } = req.body;

      const updates = {};
      if (name !== undefined) updates.name = name;
      if (condition_type !== undefined) updates.condition_type = condition_type;
      if (threshold_minutes !== undefined)
        updates.threshold_minutes = threshold_minutes !== null ? Number(threshold_minutes) : null;
      if (deduction_type !== undefined) updates.deduction_type = deduction_type;
      if (deduction_minutes !== undefined)
        updates.deduction_minutes = deduction_minutes !== null ? Number(deduction_minutes) : null;
      if (schedule_id !== undefined) updates.schedule_id = schedule_id || null;
      if (is_active !== undefined) updates.is_active = Boolean(is_active);

      const { data: policy, error } = await supabase
        .from('deduction_policies')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error || !policy) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Deduction policy not found' },
        });
      }

      return res.status(200).json({
        success: true,
        policy,
      });
    } catch (err) {
      console.error('Update policy error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * DELETE /api/hrm/policies/:id
   * Soft delete: is_active = false
   * Accessible by: owner
   */
  static async remove(req, res) {
    try {
      const { id } = req.params;

      const { data, error } = await supabase
        .from('deduction_policies')
        .update({ is_active: false })
        .eq('id', id)
        .select()
        .single();

      if (error || !data) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Deduction policy not found' },
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Deduction policy deactivated (soft deleted)',
      });
    } catch (err) {
      console.error('Delete policy error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }
}

export default PoliciesController;
