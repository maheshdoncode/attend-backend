import { supabase } from '../db/supabase.js';

export class WorkingDaysController {
  /**
   * POST /api/hrm/working-days
   * Marks a specific date (e.g., a Sunday) as an official working day for all employees, a branch, or a specific employee.
   * Accessible by: owner
   */
  static async create(req, res) {
    try {
      const { date, branch_id = null, employee_id = null, employee_ids = null, reason = null } = req.body;

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'date is required and must be in YYYY-MM-DD format',
          },
        });
      }

      // Collect target employee IDs (supports single employee_id or array employee_ids)
      let targetEmployeeIds = [];
      if (Array.isArray(employee_ids) && employee_ids.length > 0) {
        targetEmployeeIds = employee_ids.filter(Boolean);
      } else if (employee_id) {
        targetEmployeeIds = [employee_id];
      }

      // If branch_id is specified, verify existence
      if (branch_id) {
        const { data: branch, error: branchErr } = await supabase
          .from('branches')
          .select('id, name')
          .eq('id', branch_id)
          .maybeSingle();

        if (branchErr || !branch) {
          return res.status(404).json({
            success: false,
            error: {
              code: 'BRANCH_NOT_FOUND',
              message: 'Specified branch was not found',
            },
          });
        }
      }

      // If employee IDs specified, verify existence
      if (targetEmployeeIds.length > 0) {
        const { data: emps, error: empErr } = await supabase
          .from('users')
          .select('id, name')
          .in('id', targetEmployeeIds)
          .eq('is_active', true);

        if (empErr || !emps || emps.length === 0) {
          return res.status(404).json({
            success: false,
            error: {
              code: 'EMPLOYEE_NOT_FOUND',
              message: 'Specified employee(s) were not found',
            },
          });
        }
      }

      // Check for existing records on this date to avoid duplicate insertion
      let existingQuery = supabase
        .from('working_days_overrides')
        .select(`
          id,
          date,
          branch_id,
          employee_id,
          reason,
          created_at,
          branches (id, name),
          users (id, name, email)
        `)
        .eq('date', date);

      if (targetEmployeeIds.length > 0) {
        existingQuery = existingQuery.in('employee_id', targetEmployeeIds);
      } else if (branch_id) {
        existingQuery = existingQuery.eq('branch_id', branch_id).is('employee_id', null);
      } else {
        existingQuery = existingQuery.is('branch_id', null).is('employee_id', null);
      }

      const { data: existingRecords } = await existingQuery;
      const existingEmpSet = new Set((existingRecords || []).map((r) => r.employee_id).filter(Boolean));

      let rowsToInsert = [];
      if (targetEmployeeIds.length > 0) {
        const filteredEmpIds = targetEmployeeIds.filter((id) => !existingEmpSet.has(id));
        if (filteredEmpIds.length === 0) {
          return res.status(200).json({
            success: true,
            message: `Working day override already exists for the selected employee(s) on ${date}`,
            working_days: existingRecords || [],
            working_day: existingRecords && existingRecords.length > 0 ? existingRecords[0] : null,
          });
        }
        rowsToInsert = filteredEmpIds.map((empId) => ({
          date,
          branch_id: branch_id || null,
          employee_id: empId,
          reason,
        }));
      } else {
        if (existingRecords && existingRecords.length > 0) {
          return res.status(200).json({
            success: true,
            message: `Working day override already exists for this scope on ${date}`,
            working_days: existingRecords,
            working_day: existingRecords[0],
          });
        }
        rowsToInsert = [
          {
            date,
            branch_id: branch_id || null,
            employee_id: null,
            reason,
          },
        ];
      }

      const { data: records, error: insertError } = await supabase
        .from('working_days_overrides')
        .insert(rowsToInsert)
        .select(`
          id,
          date,
          branch_id,
          employee_id,
          reason,
          created_at,
          branches (id, name),
          users (id, name, email)
        `);

      if (insertError) {
        return res.status(500).json({
          success: false,
          error: {
            code: 'DB_ERROR',
            message: insertError.message,
          },
        });
      }

      const combinedRecords = [...(existingRecords || []), ...(records || [])];

      return res.status(201).json({
        success: true,
        message: `Working day override successfully added for ${date}`,
        working_days: combinedRecords,
        working_day: combinedRecords.length > 0 ? combinedRecords[0] : null,
      });
    } catch (err) {
      console.error('Create working day override error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/working-days
   * Lists working day overrides (working Sundays) filtered by date, month, year, branch, or employee.
   * Accessible by: owner, branch_manager, employee
   */
  static async list(req, res) {
    try {
      const { month, year, branch_id, employee_id, date } = req.query;

      let query = supabase
        .from('working_days_overrides')
        .select(`
          id,
          date,
          branch_id,
          employee_id,
          reason,
          created_at,
          branches (id, name),
          users (id, name, email)
        `)
        .order('date', { ascending: true });

      if (date) {
        query = query.eq('date', date);
      } else if (month && year) {
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        query = query.gte('date', startDate).lte('date', endDate);
      } else if (year) {
        query = query.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
      }

      if (branch_id) {
        query = query.or(`branch_id.eq.${branch_id},branch_id.is.null`);
      }

      if (employee_id) {
        query = query.or(`employee_id.eq.${employee_id},employee_id.is.null`);
      }

      // If caller is an employee, scope to global, their branch, or their user id
      if (req.user.role === 'employee') {
        const callerId = req.user.id;
        query = query.or(`employee_id.eq.${callerId},employee_id.is.null`);
      }

      const { data: records, error } = await query;

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      return res.status(200).json({
        success: true,
        working_days: records || [],
      });
    } catch (err) {
      console.error('List working day overrides error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * DELETE /api/hrm/working-days/:id
   * Removes a working day override.
   * Accessible by: owner
   */
  static async remove(req, res) {
    try {
      const { id } = req.params;

      const { data, error } = await supabase
        .from('working_days_overrides')
        .delete()
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      if (!data) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Working day override not found' },
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Working day override successfully removed',
      });
    } catch (err) {
      console.error('Remove working day override error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }
}

export default WorkingDaysController;
