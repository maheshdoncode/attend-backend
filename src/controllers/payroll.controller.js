import { supabase } from '../db/supabase.js';
import { PayrollService } from '../services/payroll.service.js';

export class PayrollController {
  /**
   * POST /api/hrm/payroll/generate
   * Accessible by: owner
   */
  static async generate(req, res) {
    try {
      const { month, year, employee_ids = [] } = req.body;

      if (!month || !year) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'month (1-12) and year (e.g. 2026) are required',
          },
        });
      }

      const monthNum = parseInt(month, 10);
      const yearNum = parseInt(year, 10);

      if (monthNum < 1 || monthNum > 12) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_MONTH',
            message: 'month must be between 1 and 12',
          },
        });
      }

      const results = await PayrollService.generatePayroll(monthNum, yearNum, employee_ids);

      return res.status(200).json({
        success: true,
        message: `Payroll processed for ${results.length} employee(s)`,
        payroll: results,
      });
    } catch (err) {
      console.error('Generate payroll error:', err);
      return res.status(err.status || 500).json({
        success: false,
        error: { code: err.code || 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/payroll
   * Accessible by: owner, branch_manager, employee
   * Query: ?month=&year=&employee_id=&branch_id=&status=
   */
  static async list(req, res) {
    try {
      const { month, year, employee_id, branch_id, status } = req.query;

      let query = supabase
        .from('payroll')
        .select(`
          id,
          employee_id,
          month,
          year,
          working_days,
          present_days,
          absent_days,
          late_count,
          half_day_count,
          total_deduction_amount,
          deduction_breakdown,
          gross_salary,
          net_salary,
          status,
          generated_at,
          users!payroll_employee_id_fkey (
            name,
            email,
            employee_profiles (
              employee_code,
              department
            ),
            branch_employee_assignments (
              branch_id
            )
          )
        `);

      let targetEmployeeId = employee_id;
      if (req.user.role !== 'owner') {
        targetEmployeeId = req.user.id;
      }

      if (month) query = query.eq('month', parseInt(month, 10));
      if (year) query = query.eq('year', parseInt(year, 10));
      if (targetEmployeeId) query = query.eq('employee_id', targetEmployeeId);
      if (status) query = query.eq('status', status);

      const { data: records, error } = await query.order('generated_at', { ascending: false });

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      let formatted = (records || []).map((r) => {
        const user = r.users;
        const profile = Array.isArray(user?.employee_profiles)
          ? user.employee_profiles[0]
          : user?.employee_profiles;
        const branchIds = (user?.branch_employee_assignments || []).map((b) => b.branch_id);

        return {
          id: r.id,
          employee_id: r.employee_id,
          employee_name: user?.name || null,
          employee_code: profile?.employee_code || null,
          department: profile?.department || null,
          branch_ids: branchIds,
          month: r.month,
          year: r.year,
          working_days: r.working_days,
          present_days: r.present_days,
          absent_days: r.absent_days,
          late_count: r.late_count,
          half_day_count: r.half_day_count,
          gross_salary: Number(r.gross_salary),
          total_deduction_amount: Number(r.total_deduction_amount),
          advance_deduction: Number(r.advance_deduction || 0),
          deduction_breakdown: r.deduction_breakdown,
          net_salary: Number(r.net_salary),
          status: r.status,
          generated_at: r.generated_at,
        };
      });

      // Filter by specific branch_id
      if (branch_id) {
        formatted = formatted.filter((item) => item.branch_ids.includes(branch_id));
      }

      return res.status(200).json({
        success: true,
        payroll: formatted,
      });
    } catch (err) {
      console.error('List payroll error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/payroll/:employee_id/:month/:year
   * Accessible by: owner, employee (own only), branch_manager (own only)
   */
  static async getDetail(req, res) {
    try {
      const { employee_id, month, year } = req.params;

      // Strict salary privacy: non-owners can ONLY view their own payslip
      if (req.user.role !== 'owner' && req.user.id !== employee_id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You are not authorized to view another employee’s salary or payroll' },
        });
      }

      const { data: record, error } = await supabase
        .from('payroll')
        .select(`
          *,
          users!payroll_employee_id_fkey (
            name,
            email,
            employee_profiles (*),
            branch_employee_assignments (branch_id)
          )
        `)
        .eq('employee_id', employee_id)
        .eq('month', parseInt(month, 10))
        .eq('year', parseInt(year, 10))
        .maybeSingle();

      if (error || !record) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Payroll record not found for this period' },
        });
      }

      const user = record.users;
      const profile = Array.isArray(user?.employee_profiles)
        ? user.employee_profiles[0]
        : user?.employee_profiles;

      let deductionBreakdown = Array.isArray(record.deduction_breakdown) ? [...record.deduction_breakdown] : [];
      let advanceDeduction = Number(record.advance_deduction || 0);
      let totalDeductions = Number(record.total_deduction_amount || 0);
      let grossSalary = Number(record.gross_salary || 0);

      try {
        const { data: pendingApprovedAdvances } = await supabase
          .from('advance_salaries')
          .select('*')
          .eq('employee_id', employee_id)
          .eq('status', 'approved');

        const matchingAdvances = (pendingApprovedAdvances || []).filter(
          (a) => (!a.target_month && !a.target_year) || (Number(a.target_month) === Number(month) && Number(a.target_year) === Number(year))
        );

        if (matchingAdvances.length > 0) {
          const existingAdvIds = new Set(
            deductionBreakdown
              .filter((d) => d.advance_id || (d.reason && d.reason.toLowerCase().includes('advance')))
              .map((d) => d.advance_id)
              .filter(Boolean)
          );

          let newAdvTotal = 0;
          for (const adv of matchingAdvances) {
            if (!existingAdvIds.has(adv.id)) {
              const amt = Number(adv.amount || 0);
              newAdvTotal += amt;
              advanceDeduction += amt;
              deductionBreakdown.push({
                date: adv.created_at ? adv.created_at.split('T')[0] : `${year}-${String(month).padStart(2, '0')}-01`,
                type: 'advance_salary',
                advance_id: adv.id,
                reason: adv.reason ? `Advance Salary: ${adv.reason}` : 'Advance Salary Deduction',
                amount: amt,
              });
            }
          }
          totalDeductions += newAdvTotal;
        }
      } catch (advCheckErr) {
        console.warn('Could not check pending advances for detail:', advCheckErr.message);
      }

      const netSalary = Number((grossSalary - totalDeductions).toFixed(2));

      const payload = {
        id: record.id,
        employee_id: record.employee_id,
        employee_name: user?.name,
        employee_code: profile?.employee_code,
        department: profile?.department,
        month: record.month,
        year: record.year,
        working_days: record.working_days,
        present_days: record.present_days,
        absent_days: record.absent_days,
        late_count: record.late_count,
        half_day_count: record.half_day_count,
        total_deduction_amount: totalDeductions,
        advance_deduction: advanceDeduction,
        deduction_breakdown: deductionBreakdown,
        net_salary: netSalary,
        status: record.status,
        generated_at: record.generated_at,
      };

      if (req.user.role !== "employee") {
        payload.gross_salary = Number(record.gross_salary);
      }

      return res.status(200).json({
        success: true,
        payroll: payload,
      });
    } catch (err) {
      console.error('Get payroll detail error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * PUT /api/hrm/payroll/:id/finalize
   * Accessible by: owner
   */
  static async finalize(req, res) {
    try {
      const { id } = req.params;

      const { data: record, error } = await supabase
        .from('payroll')
        .update({ status: 'finalized' })
        .eq('id', id)
        .select()
        .single();

      if (error || !record) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Payroll record not found' },
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Payroll successfully finalized',
        payroll: record,
      });
    } catch (err) {
      console.error('Finalize payroll error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }
}

export default PayrollController;
