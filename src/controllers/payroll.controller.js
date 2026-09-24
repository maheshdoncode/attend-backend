import { supabase } from '../db/supabase.js';
import { PayrollService } from '../services/payroll.service.js';

export function getPayrollVisibilityInfo(record) {
  if (!record) {
    return {
      finalized_at: null,
      is_visible_to_employee: false,
      is_accessible_to_employee: false,
      visibility_mode: 'hours',
      visibility_hours: 24,
      view_count: 0,
      first_viewed_at: null,
      last_viewed_at: null,
      is_within_24h: false,
      is_within_time: false,
      hours_remaining: 0,
      expires_at: null,
      status_label: 'Draft',
    };
  }

  const isFinalized = record.status === 'finalized';
  if (!isFinalized) {
    return {
      finalized_at: null,
      is_visible_to_employee: false,
      is_accessible_to_employee: false,
      visibility_mode: record.visibility_mode || 'hours',
      visibility_hours: Number(record.visibility_hours || 24),
      view_count: Number(record.view_count || 0),
      first_viewed_at: record.first_viewed_at || null,
      last_viewed_at: record.last_viewed_at || null,
      is_within_24h: false,
      is_within_time: false,
      hours_remaining: 0,
      expires_at: null,
      status_label: 'Draft (Hidden)',
    };
  }

  const mode = record.visibility_mode || 'hours';
  const hoursLimit = Number(record.visibility_hours || 24);
  const viewCount = Number(record.view_count || 0);
  const finalizedAt = record.finalized_at ? new Date(record.finalized_at) : (record.generated_at ? new Date(record.generated_at) : null);
  const isOwnerOverride = Boolean(record.is_visible_to_employee);

  let isWithinTime = false;
  let hoursRemaining = 0;
  let expiresAt = null;

  if (finalizedAt && !isNaN(finalizedAt.getTime())) {
    const expiresTime = finalizedAt.getTime() + hoursLimit * 60 * 60 * 1000;
    expiresAt = new Date(expiresTime).toISOString();
    const diffMs = expiresTime - Date.now();
    if (diffMs > 0) {
      isWithinTime = true;
      hoursRemaining = Math.max(0, Math.round((diffMs / (1000 * 60 * 60)) * 10) / 10);
    }
  }

  let isAccessible = isOwnerOverride;
  let statusLabel = 'Visible (Owner Override)';

  if (!isOwnerOverride) {
    if (mode === 'always') {
      isAccessible = true;
      statusLabel = 'Always Visible';
    } else if (mode === 'once') {
      isAccessible = viewCount === 0;
      statusLabel = viewCount === 0 ? 'One-Time View (Not Viewed Yet)' : 'One-Time View (Viewed - Locked)';
    } else if (mode === 'hours') {
      isAccessible = isWithinTime;
      statusLabel = isWithinTime ? `Visible (${hoursRemaining}h left of ${hoursLimit}h)` : `Hidden (${hoursLimit}h Expired)`;
    } else if (mode === 'hidden') {
      isAccessible = false;
      statusLabel = 'Hidden';
    }
  }

  return {
    finalized_at: record.finalized_at || (record.status === 'finalized' ? record.generated_at : null),
    is_visible_to_employee: isOwnerOverride,
    is_accessible_to_employee: isAccessible,
    visibility_mode: mode,
    visibility_hours: hoursLimit,
    view_count: viewCount,
    first_viewed_at: record.first_viewed_at || null,
    last_viewed_at: record.last_viewed_at || null,
    is_within_24h: isWithinTime && hoursLimit === 24,
    is_within_time: isWithinTime,
    hours_remaining: hoursRemaining,
    expires_at: expiresAt,
    status_label: statusLabel,
  };
}

export async function getGlobalPayrollVisibilitySettings() {
  try {
    const { data, error } = await supabase
      .from('organization_settings')
      .select('value')
      .eq('key', 'payroll_visibility')
      .maybeSingle();

    if (!error && data && data.value) {
      return {
        visibility_mode: data.value.mode || 'hours',
        visibility_hours: Number(data.value.hours || 24),
      };
    }
  } catch (e) {
    console.warn('Failed to read global payroll visibility settings:', e.message);
  }
  return { visibility_mode: 'hours', visibility_hours: 24 };
}

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
      const totalGross = results.reduce((acc, r) => acc + (Number(r.gross_salary) || 0), 0);
      const totalNet = results.reduce((acc, r) => acc + (Number(r.net_salary) || 0), 0);
      const totalEarned = results.reduce((acc, r) => acc + (Number(r.earned_salary) || 0), 0);

      return res.status(200).json({
        success: true,
        message: `Payroll processed for ${results.length} employee(s)`,
        generated_count: results.length,
        total_gross: totalGross,
        total_net: totalNet,
        total_earned: totalEarned,
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
          total_late_minutes,
          half_day_count,
          total_deduction_amount,
          advance_deduction,
          deduction_breakdown,
          gross_salary,
          earned_salary,
          net_salary,
          status,
          finalized_at,
          is_visible_to_employee,
          visibility_mode,
          visibility_hours,
          view_count,
          first_viewed_at,
          last_viewed_at,
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
        const visibility = getPayrollVisibilityInfo(r);

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
          total_late_minutes: Number(r.total_late_minutes || 0),
          half_day_count: r.half_day_count,
          gross_salary: Number(r.gross_salary),
          earned_salary: Number(r.earned_salary || 0),
          total_deduction_amount: Number(r.total_deduction_amount),
          advance_deduction: Number(r.advance_deduction || 0),
          deduction_breakdown: r.deduction_breakdown,
          net_salary: Number(r.net_salary),
          status: r.status,
          generated_at: r.generated_at,
          ...visibility,
        };
      });

      // Filter by specific branch_id
      if (branch_id) {
        formatted = formatted.filter((item) => item.branch_ids.includes(branch_id));
      }

      // Filter for regular employee: only show accessible finalized records
      if (req.user.role === 'employee') {
        formatted = formatted.filter((item) => item.status === 'finalized' && item.is_accessible_to_employee);
      }

      return res.status(200).json({
        success: true,
        payroll: formatted,
        payrolls: formatted,
        records: formatted,
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

      const visibility = getPayrollVisibilityInfo(record);

      // Access restriction & tracking for employee role
      if (req.user.role === 'employee') {
        if (record.status !== 'finalized') {
          return res.status(403).json({
            success: false,
            error: {
              code: 'PAYROLL_NOT_FINALIZED',
              message: 'Payroll for this month is currently in draft and not yet finalized by the administrator.',
            },
          });
        }

        if (!visibility.is_accessible_to_employee) {
          if (visibility.visibility_mode === 'once' && visibility.view_count >= 1) {
            return res.status(403).json({
              success: false,
              is_expired: true,
              error: {
                code: 'ONE_TIME_VIEW_EXPIRED',
                message: 'This payslip was configured for One-Time View and has already been viewed. Please contact your administrator to grant access again.',
              },
            });
          }

          return res.status(403).json({
            success: false,
            is_expired: true,
            error: {
              code: 'PAYROLL_VIEW_EXPIRED',
              message: 'The viewing window for this payslip has expired. Please contact your administrator to grant access.',
            },
          });
        }

        // Increment view count and record view timestamp asynchronously
        const nowIso = new Date().toISOString();
        const updateViewPayload = {
          view_count: (record.view_count || 0) + 1,
          last_viewed_at: nowIso,
        };
        if (!record.first_viewed_at) {
          updateViewPayload.first_viewed_at = nowIso;
        }
        await supabase
          .from('payroll')
          .update(updateViewPayload)
          .eq('id', record.id);
      }

      const user = record.users;
      const profile = Array.isArray(user?.employee_profiles)
        ? user.employee_profiles[0]
        : user?.employee_profiles;

      let deductionBreakdown = Array.isArray(record.deduction_breakdown) ? [...record.deduction_breakdown] : [];
      let advanceDeduction = Number(record.advance_deduction || 0);
      let totalDeductions = Number(record.total_deduction_amount || 0);
      let earnedSalary = Number(record.earned_salary || 0);
      let netSalary = Number(record.net_salary || 0);

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
          netSalary = Math.max(0, Number((netSalary - newAdvTotal).toFixed(2)));
        }
      } catch (advCheckErr) {
        console.warn('Could not check pending advances for detail:', advCheckErr.message);
      }

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
        total_late_minutes: Number(record.total_late_minutes || 0),
        half_day_count: record.half_day_count,
        earned_salary: earnedSalary,
        total_deduction_amount: totalDeductions,
        advance_deduction: advanceDeduction,
        deduction_breakdown: deductionBreakdown,
        daily_records: record.daily_records || [],
        net_salary: netSalary,
        status: record.status,
        generated_at: record.generated_at,
        ...visibility,
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
   * Body: { visibility_mode?: 'hours'|'once'|'always'|'hidden', visibility_hours?: number }
   */
  static async finalize(req, res) {
    try {
      const { id } = req.params;
      let { visibility_mode, visibility_hours } = req.body || {};

      if (!visibility_mode || visibility_hours === undefined) {
        const globalSettings = await getGlobalPayrollVisibilitySettings();
        if (!visibility_mode) visibility_mode = globalSettings.visibility_mode;
        if (visibility_hours === undefined) visibility_hours = globalSettings.visibility_hours;
      }

      const nowIso = new Date().toISOString();

      const { data: record, error } = await supabase
        .from('payroll')
        .update({
          status: 'finalized',
          finalized_at: nowIso,
          visibility_mode,
          visibility_hours: Number(visibility_hours) || 24,
          view_count: 0,
          first_viewed_at: null,
          last_viewed_at: null,
          is_visible_to_employee: false,
        })
        .eq('id', id)
        .select()
        .single();

      if (error || !record) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Payroll record not found' },
        });
      }

      const visibility = getPayrollVisibilityInfo(record);

      return res.status(200).json({
        success: true,
        message: 'Payroll successfully finalized',
        payroll: {
          ...record,
          ...visibility,
        },
      });
    } catch (err) {
      console.error('Finalize payroll error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * PUT /api/hrm/payroll/:id/visibility
   * Accessible by: owner
   * Body: { visibility_mode?: string, visibility_hours?: number, is_visible?: boolean, reset_view?: boolean, reset_timer?: boolean }
   */
  static async updateVisibility(req, res) {
    try {
      const { id } = req.params;
      const {
        visibility_mode,
        visibility_hours,
        is_visible,
        reset_view,
        reset_timer,
      } = req.body;

      const updateData = {};
      if (is_visible !== undefined) {
        updateData.is_visible_to_employee = Boolean(is_visible);
      }
      if (visibility_mode !== undefined) {
        updateData.visibility_mode = visibility_mode;
      }
      if (visibility_hours !== undefined) {
        updateData.visibility_hours = Number(visibility_hours);
      }
      if (reset_view) {
        updateData.view_count = 0;
        updateData.first_viewed_at = null;
        updateData.last_viewed_at = null;
      }
      if (reset_timer) {
        updateData.finalized_at = new Date().toISOString();
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'No valid update fields provided' },
        });
      }

      const { data: record, error } = await supabase
        .from('payroll')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error || !record) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Payroll record not found' },
        });
      }

      const visibility = getPayrollVisibilityInfo(record);

      return res.status(200).json({
        success: true,
        message: 'Visibility configuration updated successfully',
        payroll: {
          ...record,
          ...visibility,
        },
      });
    } catch (err) {
      console.error('Update payroll visibility error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * PUT /api/hrm/payroll/bulk-visibility
   * Accessible by: owner
   * Body: { payroll_ids: string[], visibility_mode?: string, visibility_hours?: number, is_visible?: boolean, reset_view?: boolean, reset_timer?: boolean }
   */
  static async updateBulkVisibility(req, res) {
    try {
      const {
        payroll_ids,
        visibility_mode,
        visibility_hours,
        is_visible,
        reset_view,
        reset_timer,
      } = req.body;

      if (!Array.isArray(payroll_ids) || payroll_ids.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'payroll_ids array is required' },
        });
      }

      const updateData = {};
      if (is_visible !== undefined) updateData.is_visible_to_employee = Boolean(is_visible);
      if (visibility_mode !== undefined) updateData.visibility_mode = visibility_mode;
      if (visibility_hours !== undefined) updateData.visibility_hours = Number(visibility_hours);
      if (reset_view) {
        updateData.view_count = 0;
        updateData.first_viewed_at = null;
        updateData.last_viewed_at = null;
      }
      if (reset_timer) updateData.finalized_at = new Date().toISOString();

      const { data: updatedRecords, error } = await supabase
        .from('payroll')
        .update(updateData)
        .in('id', payroll_ids)
        .select();

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      return res.status(200).json({
        success: true,
        message: `Updated visibility for ${updatedRecords?.length || 0} payroll record(s)`,
        updated_count: updatedRecords?.length || 0,
      });
    } catch (err) {
      console.error('Bulk update payroll visibility error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/payroll/settings/visibility
   * Accessible by: owner, branch_manager
   */
  static async getGlobalVisibility(req, res) {
    try {
      const settings = await getGlobalPayrollVisibilitySettings();
      return res.status(200).json({
        success: true,
        settings,
      });
    } catch (err) {
      console.error('Get global payroll visibility settings error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * PUT /api/hrm/payroll/settings/visibility
   * Accessible by: owner
   * Body: { visibility_mode?: string, visibility_hours?: number, apply_to_existing?: boolean }
   */
  static async updateGlobalVisibility(req, res) {
    try {
      const {
        visibility_mode = 'hours',
        visibility_hours = 24,
        apply_to_existing = true,
      } = req.body || {};

      const value = {
        mode: visibility_mode,
        hours: Number(visibility_hours) || 24,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase
        .from('organization_settings')
        .upsert(
          {
            key: 'payroll_visibility',
            value,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' }
        );

      if (upsertError) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: upsertError.message },
        });
      }

      let updatedCount = 0;
      if (apply_to_existing) {
        const payrollUpdates = {
          visibility_mode,
          visibility_hours: Number(visibility_hours) || 24,
        };

        if (visibility_mode === 'always') {
          payrollUpdates.is_visible_to_employee = true;
        } else if (visibility_mode === 'hidden') {
          payrollUpdates.is_visible_to_employee = false;
        } else if (visibility_mode === 'once') {
          payrollUpdates.is_visible_to_employee = false;
          payrollUpdates.view_count = 0;
          payrollUpdates.first_viewed_at = null;
          payrollUpdates.last_viewed_at = null;
        } else if (visibility_mode === 'hours') {
          payrollUpdates.is_visible_to_employee = false;
          payrollUpdates.finalized_at = new Date().toISOString();
        }

        const { data: updatedRecords, error: updateError } = await supabase
          .from('payroll')
          .update(payrollUpdates)
          .not('id', 'is', null)
          .select('id');

        if (updateError) {
          console.error('Error applying global visibility to payroll records:', updateError);
        } else if (updatedRecords) {
          updatedCount = updatedRecords.length;
        }
      }

      return res.status(200).json({
        success: true,
        message: `Global payroll visibility updated and applied to ${updatedCount} payroll record(s)`,
        settings: {
          visibility_mode,
          visibility_hours: Number(visibility_hours) || 24,
        },
        applied_to_existing: Boolean(apply_to_existing),
        updated_count: updatedCount,
      });
    } catch (err) {
      console.error('Update global payroll visibility settings error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }
}

export default PayrollController;
