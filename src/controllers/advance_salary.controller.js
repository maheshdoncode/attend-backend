import { supabase } from '../db/supabase.js';

export class AdvanceSalaryController {
  /**
   * POST /api/hrm/advance-salary
   * Accessible by: owner, branch_manager, employee
   */
  static async create(req, res) {
    try {
      const {
        employee_id,
        amount,
        reason,
        target_month,
        target_year,
        notes,
        status: requestedStatus,
      } = req.body;

      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'amount is required and must be a positive number',
          },
        });
      }

      // Determine target employee ID based on caller role
      let targetEmployeeId = employee_id;
      if (req.user.role === 'employee') {
        targetEmployeeId = req.user.id;
      } else if (!targetEmployeeId) {
        targetEmployeeId = req.user.id;
      }

      // Branch Manager check: ensure target employee belongs to their assigned branch
      if (req.user.role === 'branch_manager' && targetEmployeeId !== req.user.id) {
        const scopedBranchIds = req.scopedBranchIds || [];
        const { data: assignments } = await supabase
          .from('branch_employee_assignments')
          .select('branch_id')
          .eq('employee_id', targetEmployeeId);

        const empBranchIds = (assignments || []).map((a) => a.branch_id);
        const hasAccess = empBranchIds.some((bId) => scopedBranchIds.includes(bId));

        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'You cannot request advance salary for an employee outside your assigned branch',
            },
          });
        }
      }

      // Verify target user exists
      const { data: targetUser, error: userErr } = await supabase
        .from('users')
        .select('id, name, email, role, is_active')
        .eq('id', targetEmployeeId)
        .maybeSingle();

      if (userErr || !targetUser) {
        return res.status(404).json({
          success: false,
          error: { code: 'EMPLOYEE_NOT_FOUND', message: 'Target employee not found' },
        });
      }

      if (!targetUser.is_active) {
        return res.status(400).json({
          success: false,
          error: { code: 'EMPLOYEE_INACTIVE', message: 'Cannot issue advance salary to an inactive employee' },
        });
      }

      // Determine initial status:
      // If Owner creates -> default to 'approved' (or whatever owner specifies: 'approved' | 'pending')
      // If Non-owner creates -> strictly 'pending'
      let initialStatus = 'pending';
      let approvedBy = null;
      let approvedAt = null;

      if (req.user.role === 'owner') {
        initialStatus = requestedStatus === 'pending' ? 'pending' : 'approved';
        if (initialStatus === 'approved') {
          approvedBy = req.user.id;
          approvedAt = new Date().toISOString();
        }
      }

      const numAmount = Number(Number(amount).toFixed(2));
      const parsedMonth = target_month ? parseInt(target_month, 10) : null;
      const parsedYear = target_year ? parseInt(target_year, 10) : null;

      const { data: record, error: insertErr } = await supabase
        .from('advance_salaries')
        .insert({
          employee_id: targetEmployeeId,
          amount: numAmount,
          reason: reason || null,
          target_month: parsedMonth,
          target_year: parsedYear,
          status: initialStatus,
          approved_by: approvedBy,
          approved_at: approvedAt,
          notes: notes || null,
        })
        .select()
        .single();

      if (insertErr) {
        if (insertErr.code === 'PGRST205') {
          return res.status(500).json({
            success: false,
            error: {
              code: 'TABLE_NOT_FOUND',
              message: 'advance_salaries table not found in database. Please run migrations/schema.sql in Supabase SQL editor.',
            },
          });
        }
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: insertErr.message },
        });
      }

      return res.status(201).json({
        success: true,
        message: initialStatus === 'approved'
          ? 'Advance salary granted and approved successfully'
          : 'Advance salary request submitted successfully',
        advance_salary: {
          ...record,
          employee_name: targetUser.name,
          employee_email: targetUser.email,
        },
      });
    } catch (err) {
      console.error('Create advance salary error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/advance-salary
   * Accessible by: owner, branch_manager, employee
   * Query: ?employee_id=&status=&target_month=&target_year=&branch_id=&page=1&limit=50
   */
  static async list(req, res) {
    try {
      const {
        employee_id,
        status,
        target_month,
        target_year,
        branch_id,
        page = 1,
        limit = 50,
      } = req.query;

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const offset = (pageNum - 1) * limitNum;

      let query = supabase
        .from('advance_salaries')
        .select(
          `
          *,
          users!advance_salaries_employee_id_fkey (
            id,
            name,
            email,
            role,
            employee_profiles (
              employee_code,
              department
            ),
            branch_employee_assignments (
              branch_id,
              branches (id, name)
            )
          ),
          approver:users!advance_salaries_approved_by_fkey (
            id,
            name,
            email
          )
        `,
          { count: 'exact' }
        );

      // Scoping based on role
      if (req.user.role === 'employee') {
        query = query.eq('employee_id', req.user.id);
      } else if (employee_id) {
        query = query.eq('employee_id', employee_id);
      }

      if (status && status !== 'all') {
        query = query.eq('status', status);
      }

      if (target_month) {
        query = query.eq('target_month', parseInt(target_month, 10));
      }

      if (target_year) {
        query = query.eq('target_year', parseInt(target_year, 10));
      }

      const { data: records, count, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limitNum - 1);

      if (error) {
        if (error.code === 'PGRST205') {
          return res.status(200).json({
            success: true,
            total: 0,
            page: pageNum,
            limit: limitNum,
            advance_salaries: [],
            message: 'advance_salaries table not yet created in database.',
          });
        }
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      // Format response & apply post-filter for branch scoping if manager
      let formatted = (records || []).map((r) => {
        const u = r.users || {};
        const profile = Array.isArray(u.employee_profiles)
          ? u.employee_profiles[0]
          : u.employee_profiles;
        const branches = (u.branch_employee_assignments || [])
          .map((a) => a.branches)
          .filter(Boolean);

        return {
          id: r.id,
          employee_id: r.employee_id,
          employee_name: u.name || '-',
          employee_email: u.email || '-',
          employee_code: profile?.employee_code || '-',
          department: profile?.department || '-',
          amount: Number(r.amount),
          reason: r.reason,
          target_month: r.target_month,
          target_year: r.target_year,
          status: r.status,
          approved_by: r.approved_by,
          approver_name: r.approver?.name || (r.approved_by ? 'Owner' : null),
          approved_at: r.approved_at,
          payroll_id: r.payroll_id,
          deducted_at: r.deducted_at,
          notes: r.notes,
          created_at: r.created_at,
          branches,
        };
      });

      // Branch filter
      if (branch_id) {
        formatted = formatted.filter((r) =>
          r.branches.some((b) => b.id === branch_id)
        );
      }

      // Branch manager scoping
      if (req.user.role === 'branch_manager') {
        const scopedIds = new Set(req.scopedBranchIds || []);
        formatted = formatted.filter(
          (r) => r.employee_id === req.user.id || r.branches.some((b) => scopedIds.has(b.id))
        );
      }

      return res.status(200).json({
        success: true,
        total: count || formatted.length,
        page: pageNum,
        limit: limitNum,
        advance_salaries: formatted,
      });
    } catch (err) {
      console.error('List advance salary error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/advance-salary/summary
   * Returns aggregate tracking metrics (total advance given, total deducted, outstanding balance)
   * Accessible by: owner, branch_manager, employee
   */
  static async getSummary(req, res) {
    try {
      const { employee_id, target_month, target_year } = req.query;

      let query = supabase.from('advance_salaries').select('*');

      if (req.user.role === 'employee') {
        query = query.eq('employee_id', req.user.id);
      } else if (employee_id) {
        query = query.eq('employee_id', employee_id);
      }

      if (target_month) {
        query = query.eq('target_month', parseInt(target_month, 10));
      }

      if (target_year) {
        query = query.eq('target_year', parseInt(target_year, 10));
      }

      const { data: records, error } = await query;

      if (error) {
        if (error.code === 'PGRST205') {
          return res.status(200).json({
            success: true,
            summary: {
              total_approved_amount: 0,
              total_deducted_amount: 0,
              total_pending_amount: 0,
              outstanding_balance: 0,
              total_requests_count: 0,
            },
          });
        }
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      let totalApproved = 0;
      let totalDeducted = 0;
      let totalPending = 0;
      let pendingCount = 0;
      let approvedCount = 0;
      let deductedCount = 0;

      (records || []).forEach((r) => {
        const amt = Number(r.amount) || 0;
        if (r.status === 'approved') {
          totalApproved += amt;
          approvedCount++;
        } else if (r.status === 'deducted') {
          totalApproved += amt;
          totalDeducted += amt;
          deductedCount++;
        } else if (r.status === 'pending') {
          totalPending += amt;
          pendingCount++;
        }
      });

      const outstandingBalance = Math.max(0, Number((totalApproved - totalDeducted).toFixed(2)));

      return res.status(200).json({
        success: true,
        summary: {
          total_approved_amount: Number(totalApproved.toFixed(2)),
          total_deducted_amount: Number(totalDeducted.toFixed(2)),
          total_pending_amount: Number(totalPending.toFixed(2)),
          outstanding_balance: outstandingBalance,
          total_requests_count: (records || []).length,
          pending_count: pendingCount,
          approved_count: approvedCount,
          deducted_count: deductedCount,
        },
      });
    } catch (err) {
      console.error('Get advance salary summary error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/advance-salary/:id
   */
  static async getById(req, res) {
    try {
      const { id } = req.params;

      const { data: record, error } = await supabase
        .from('advance_salaries')
        .select(
          `
          *,
          users!advance_salaries_employee_id_fkey (
            id,
            name,
            email,
            role,
            employee_profiles (employee_code, department)
          ),
          approver:users!advance_salaries_approved_by_fkey (
            id,
            name,
            email
          )
        `
        )
        .eq('id', id)
        .maybeSingle();

      if (error || !record) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Advance salary record not found' },
        });
      }

      // Security check: employee can only view their own
      if (req.user.role === 'employee' && record.employee_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied to this advance salary record' },
        });
      }

      return res.status(200).json({
        success: true,
        advance_salary: record,
      });
    } catch (err) {
      console.error('Get advance salary by id error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * PUT /api/hrm/advance-salary/:id/status
   * Accessible by: owner only
   * Body: { "status": "approved" | "rejected", "notes": "..." }
   */
  static async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;

      if (!status || !['approved', 'rejected', 'pending'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: "status is required and must be 'approved', 'rejected', or 'pending'",
          },
        });
      }

      const { data: existing, error: fetchErr } = await supabase
        .from('advance_salaries')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !existing) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Advance salary record not found' },
        });
      }

      if (existing.status === 'deducted') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'ALREADY_DEDUCTED',
            message: 'This advance salary has already been deducted in payroll and its status cannot be modified',
          },
        });
      }

      const updatePayload = {
        status,
        notes: notes !== undefined ? notes : existing.notes,
      };

      if (status === 'approved') {
        updatePayload.approved_by = req.user.id;
        updatePayload.approved_at = new Date().toISOString();
      } else if (status === 'rejected') {
        updatePayload.approved_by = req.user.id;
        updatePayload.approved_at = new Date().toISOString();
      } else if (status === 'pending') {
        updatePayload.approved_by = null;
        updatePayload.approved_at = null;
      }

      const { data: updated, error: updateErr } = await supabase
        .from('advance_salaries')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();

      if (updateErr) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: updateErr.message },
        });
      }

      return res.status(200).json({
        success: true,
        message: `Advance salary request ${status} successfully`,
        advance_salary: updated,
      });
    } catch (err) {
      console.error('Update advance salary status error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * DELETE /api/hrm/advance-salary/:id
   * Accessible by: owner, branch_manager, employee
   */
  static async remove(req, res) {
    try {
      const { id } = req.params;

      const { data: record, error: fetchErr } = await supabase
        .from('advance_salaries')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !record) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Advance salary record not found' },
        });
      }

      if (record.status === 'deducted') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'CANNOT_DELETE_DEDUCTED',
            message: 'Cannot delete an advance salary that has already been deducted in payroll',
          },
        });
      }

      // Non-owners can only cancel their own pending requests
      if (req.user.role !== 'owner') {
        if (record.employee_id !== req.user.id) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You can only cancel your own advance salary requests' },
          });
        }
        if (record.status !== 'pending') {
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'You can only cancel pending requests. Approved advances can only be removed by the Owner.',
            },
          });
        }
      }

      const { error: deleteErr } = await supabase
        .from('advance_salaries')
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
        message: 'Advance salary request deleted/cancelled successfully',
      });
    } catch (err) {
      console.error('Delete advance salary error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }
}

export default AdvanceSalaryController;
