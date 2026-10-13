import { supabase } from '../db/supabase.js';

export class HolidaysController {
  /**
   * POST /api/hrm/holidays
   * Accessible by: owner, branch_manager
   */
  static async create(req, res) {
    try {
      const { date, start_date, end_date, name, branch_id = null } = req.body;

      if ((!date && (!start_date || !end_date)) || !name) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'date (or start_date and end_date) and name are required',
          },
        });
      }

      // Branch Manager & Admin permission checks
      if (req.user.role === 'branch_manager' || req.user.role === 'admin') {
        if (!branch_id) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Branch managers cannot create global holidays; branch_id is required',
            },
          });
        }

        const scopedIds = req.scopedBranchIds || [];
        if (!scopedIds.includes(branch_id)) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Cannot create holiday for a branch outside your management scope',
            },
          });
        }
      }

      let datesToInsert = [];
      if (start_date && end_date) {
        const start = new Date(`${start_date}T00:00:00Z`);
        const end = new Date(`${end_date}T00:00:00Z`);
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Invalid start_date or end_date' },
          });
        }
        for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
          datesToInsert.push(dt.toISOString().slice(0, 10));
        }
      } else {
        datesToInsert = [date];
      }

      const rows = datesToInsert.map((d) => ({
        date: d,
        name: name.trim(),
        branch_id: branch_id || null,
      }));

      const { data: holidays, error } = await supabase
        .from('holidays')
        .insert(rows)
        .select();

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      return res.status(201).json({
        success: true,
        holiday: holidays?.[0] || null,
        holidays: holidays || [],
        count: holidays?.length || 0,
      });
    } catch (err) {
      console.error('Create holiday error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/holidays
   * Accessible by: all authenticated
   * Query: ?month=&year=&branch_id=
   */
  static async list(req, res) {
    try {
      const { month, year, branch_id } = req.query;

      let query = supabase.from('holidays').select(`
        id,
        date,
        name,
        branch_id,
        created_at,
        branches (name)
      `);

      if (branch_id) {
        query = query.or(`branch_id.eq.${branch_id},branch_id.is.null`);
      }

      if (month && year) {
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        query = query.gte('date', startDate).lte('date', endDate);
      } else if (year) {
        query = query.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
      }

      const { data: holidays, error } = await query.order('date', { ascending: true });

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      const formatted = (holidays || []).map((h) => ({
        id: h.id,
        date: h.date,
        name: h.name,
        branch_id: h.branch_id,
        branch_name: h.branches?.name || 'All Branches (Global)',
        created_at: h.created_at,
      }));

      return res.status(200).json({
        success: true,
        holidays: formatted,
      });
    } catch (err) {
      console.error('List holidays error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * DELETE /api/hrm/holidays/:id
   * Accessible by: owner, branch_manager
   */
  static async remove(req, res) {
    try {
      const { id } = req.params;

      const { data: holiday, error: fetchErr } = await supabase
        .from('holidays')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !holiday) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Holiday not found' },
        });
      }

      if (req.user.role === 'branch_manager' || req.user.role === 'admin') {
        const scopedIds = req.scopedBranchIds || [];
        if (!holiday.branch_id || !scopedIds.includes(holiday.branch_id)) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Branch managers can only delete holidays for their assigned branch',
            },
          });
        }
      }

      const { error: deleteErr } = await supabase
        .from('holidays')
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
        message: 'Holiday removed successfully',
      });
    } catch (err) {
      console.error('Delete holiday error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }
}

export default HolidaysController;
