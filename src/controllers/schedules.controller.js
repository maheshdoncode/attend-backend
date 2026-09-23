import { supabase } from '../db/supabase.js';

export class SchedulesController {
  /**
   * POST /api/hrm/schedules
   * Accessible by: owner
   */
  static async create(req, res) {
    try {
      const { name, start_time, end_time, is_default = false, early_clock_in_limit_minutes = 30 } = req.body;

      if (!name || !start_time || !end_time) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Name, start_time, and end_time are required',
          },
        });
      }

      // If is_default is true, unset default on all other schedules
      if (is_default) {
        await supabase
          .from('work_schedules')
          .update({ is_default: false })
          .neq('id', '00000000-0000-0000-0000-000000000000');
      }

      const { data: schedule, error } = await supabase
        .from('work_schedules')
        .insert({
          name,
          start_time,
          end_time,
          is_default: Boolean(is_default),
          early_clock_in_limit_minutes: Number(early_clock_in_limit_minutes) || 30,
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
        schedule,
      });
    } catch (err) {
      console.error('Create schedule error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/schedules
   * Accessible by: owner, branch_manager
   */
  static async list(req, res) {
    try {
      const { data: schedules, error } = await supabase
        .from('work_schedules')
        .select('*')
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      return res.status(200).json({
        success: true,
        schedules: schedules || [],
      });
    } catch (err) {
      console.error('List schedules error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * PUT /api/hrm/schedules/:id
   * Accessible by: owner
   */
  static async update(req, res) {
    try {
      const { id } = req.params;
      const { name, start_time, end_time, is_default, early_clock_in_limit_minutes } = req.body;

      if (is_default === true) {
        await supabase
          .from('work_schedules')
          .update({ is_default: false })
          .neq('id', id);
      }

      const updates = {};
      if (name !== undefined) updates.name = name;
      if (start_time !== undefined) updates.start_time = start_time;
      if (end_time !== undefined) updates.end_time = end_time;
      if (is_default !== undefined) updates.is_default = Boolean(is_default);
      if (early_clock_in_limit_minutes !== undefined) updates.early_clock_in_limit_minutes = Number(early_clock_in_limit_minutes) || 30;

      const { data: schedule, error } = await supabase
        .from('work_schedules')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error || !schedule) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Work schedule not found' },
        });
      }

      return res.status(200).json({
        success: true,
        schedule,
      });
    } catch (err) {
      console.error('Update schedule error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * DELETE /api/hrm/schedules/:id
   * Accessible by: owner
   */
  static async remove(req, res) {
    try {
      const { id } = req.params;

      // 1. Fetch the schedule
      const { data: schedule, error: fetchErr } = await supabase
        .from('work_schedules')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !schedule) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Work schedule not found' },
        });
      }

      // Check total schedules count
      const { count } = await supabase
        .from('work_schedules')
        .select('*', { count: 'exact', head: true });

      if (schedule.is_default && count <= 1) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'CANNOT_DELETE_DEFAULT',
            message: 'Cannot delete the only default schedule without another schedule present.',
          },
        });
      }

      const { error: deleteErr } = await supabase
        .from('work_schedules')
        .delete()
        .eq('id', id);

      if (deleteErr) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: deleteErr.message },
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Schedule deleted successfully',
      });
    } catch (err) {
      console.error('Delete schedule error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * POST /api/hrm/employees/:id/schedule
   * Accessible by: owner, branch_manager
   */
  static async assignEmployeeSchedule(req, res) {
    try {
      const { id: employee_id } = req.params;
      const { schedule_id } = req.body;

      if (!schedule_id) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'schedule_id is required' },
        });
      }

      // Check schedule exists
      const { data: schedule, error: schErr } = await supabase
        .from('work_schedules')
        .select('id')
        .eq('id', schedule_id)
        .maybeSingle();

      if (schErr || !schedule) {
        return res.status(404).json({
          success: false,
          error: { code: 'SCHEDULE_NOT_FOUND', message: 'Target work schedule does not exist' },
        });
      }

      // Upsert override
      const { data, error } = await supabase
        .from('employee_schedule_overrides')
        .upsert({ employee_id, schedule_id }, { onConflict: 'employee_id' })
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
        message: 'Employee schedule override applied successfully',
        override: data,
      });
    } catch (err) {
      console.error('Assign employee schedule error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * DELETE /api/hrm/employees/:id/schedule
   * Accessible by: owner
   */
  static async removeEmployeeScheduleOverride(req, res) {
    try {
      const { id: employee_id } = req.params;

      const { error } = await supabase
        .from('employee_schedule_overrides')
        .delete()
        .eq('employee_id', employee_id);

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Schedule override removed; employee will use the default work schedule.',
      });
    } catch (err) {
      console.error('Remove employee schedule override error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }
}

export default SchedulesController;
