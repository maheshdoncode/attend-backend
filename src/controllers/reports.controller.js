import { supabase } from '../db/supabase.js';
import {
  generateAttendanceExcel,
  generatePayrollPDF,
  generatePayrollExcel,
} from '../utils/export.js';
import {
  getTodayIST,
  getCurrentMinutesIST,
  parseTimeToMinutes,
} from '../utils/schedule.js';

/**
 * Helper to fetch all attendance records for a list of employee IDs and date range,
 * paginating past PostgREST's default 1,000-row limit.
 */
async function fetchMonthlyAttendanceRecords(employeeIds, startDate, endDate) {
  if (!employeeIds || employeeIds.length === 0) return [];

  const PAGE_SIZE = 1000;
  const buildQuery = (from, to) =>
    supabase
      .from('attendance')
      .select('employee_id, date, status, is_flagged, flag_reason, schedule_id')
      .in('employee_id', employeeIds)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })
      .range(from, to);

  // Parallel fetch first two pages (up to 2,000 records) in a single round-trip
  const [res0, res1] = await Promise.all([
    buildQuery(0, 999),
    buildQuery(1000, 1999),
  ]);

  if (res0.error) throw res0.error;
  if (res1.error) throw res1.error;

  const allRecords = [...(res0.data || []), ...(res1.data || [])];

  // If there are more than 2,000 records, fetch subsequent pages
  if (res1.data && res1.data.length === PAGE_SIZE) {
    let from = 2000;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      if (data && data.length > 0) {
        allRecords.push(...data);
        if (data.length < PAGE_SIZE) hasMore = false;
        else from += PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }
  }

  return allRecords;
}

export class ReportsController {
  /**
   * GET /api/hrm/reports/attendance
   * Accessible by: owner, branch_manager
   * Query: ?month=&year=&branch_id=&employee_id=
   */
  static async getAttendanceReport(req, res) {
    try {
      const { month, year, branch_id, employee_id } = req.query;

      if (!month || !year) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'month and year are required' },
        });
      }

      const monthNum = parseInt(month, 10);
      const yearNum = parseInt(year, 10);
      const startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
      const lastDay = new Date(yearNum, monthNum, 0).getDate();
      const endDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      // 1. Fetch employees, holidays, overrides, and schedules concurrently in Round 1
      let empQuery = supabase
        .from('users')
        .select(`
          id,
          name,
          employee_profiles (employee_code, department),
          branch_employee_assignments (branch_id), branch_managers (branch_id)
        `)
        .in('role', ['employee', 'branch_manager', 'admin'])
        .eq('is_active', true);

      if (employee_id) empQuery = empQuery.eq('id', employee_id);

      const [
        rawEmpRes,
        holidaysRes,
        overridesRes,
        schedulesRes,
      ] = await Promise.all([
        empQuery,
        supabase
          .from('holidays')
          .select('*')
          .gte('date', startDate)
          .lte('date', endDate),
        supabase
          .from('working_days_overrides')
          .select('*')
          .gte('date', startDate)
          .lte('date', endDate),
        supabase.from('work_schedules').select('*'),
      ]);

      if (rawEmpRes.error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: rawEmpRes.error.message },
        });
      }

      const rawEmployees = rawEmpRes.data || [];

      // Filter employees by branch / scope
      let employees = rawEmployees.map((e) => {
        const profile = Array.isArray(e.employee_profiles)
          ? e.employee_profiles[0]
          : e.employee_profiles;
        const empB = (e.branch_employee_assignments || []).map((b) => b.branch_id); const mgrB = (e.branch_managers || []).map((b) => b.branch_id); const branchIds = Array.from(new Set([...empB, ...mgrB]));
        return {
          id: e.id,
          name: e.name,
          employee_code: profile?.employee_code || null,
          department: profile?.department || null,
          branch_ids: branchIds,
        };
      });

      if (branch_id) {
        employees = employees.filter((e) => e.branch_ids.includes(branch_id));
      }

      if (req.user.role === 'branch_manager' || req.user.role === 'admin') {
        const scopedIds = new Set(req.scopedBranchIds || []);
        employees = employees.filter((e) => e.branch_ids.some((b) => scopedIds.has(b)));
      }

      const employeeIds = employees.map((e) => e.id);

      const holidaysList = holidaysRes.data || [];
      const workingDaysOverrides = overridesRes.data || [];
      const allSchedules = schedulesRes.data || [];
      const scheduleMap = new Map((allSchedules || []).map((s) => [s.id, s]));
      const defaultSchedule =
        (allSchedules || []).find((s) => s.is_default) ||
        allSchedules?.[0] || {
          id: null,
          start_time: '09:00:00',
          end_time: '18:00:00',
          name: 'Day Shift',
        };

      if (employeeIds.length === 0) {
        return res.status(200).json({
          success: true,
          month: monthNum,
          year: yearNum,
          holidays: holidaysList,
          shifts: [],
          employees: [],
        });
      }

      // 2. Fetch attendance records and shift assignments in parallel Round 2
      const [
        attendanceList,
        shiftAssignmentsRes,
        overridesSchedulesRes,
      ] = await Promise.all([
        fetchMonthlyAttendanceRecords(employeeIds, startDate, endDate),
        supabase
          .from('employee_shift_assignments')
          .select('employee_id, schedule_id')
          .in('employee_id', employeeIds),
        supabase
          .from('employee_schedule_overrides')
          .select('employee_id, schedule_id, work_schedules(*)')
          .in('employee_id', employeeIds),
      ]);

      // Map employee shift assignments
      const empShiftAssignmentsMap = new Map();
      (shiftAssignmentsRes.data || []).forEach((sa) => {
        if (!empShiftAssignmentsMap.has(sa.employee_id)) {
          empShiftAssignmentsMap.set(sa.employee_id, []);
        }
        const sch = scheduleMap.get(sa.schedule_id);
        if (sch) empShiftAssignmentsMap.get(sa.employee_id).push(sch);
      });

      // Map schedule overrides
      const scheduleOverrideMap = new Map();
      (overridesSchedulesRes.data || []).forEach((ov) => {
        if (ov.work_schedules) {
          scheduleOverrideMap.set(ov.employee_id, ov.work_schedules);
        }
      });

      // Index attendance into Map by `${employee_id}_${date}` for O(1) lookup
      const empAttDateMap = new Map();
      (attendanceList || []).forEach((att) => {
        const isFlaggedLate =
          Boolean(att.is_flagged) &&
          (String(att.flag_reason || '').toLowerCase().includes('late') ||
            String(att.flag_reason || '').toLowerCase().includes('arrival'));

        const isLate = att.status === 'late' || isFlaggedLate;
        const isHalfDay = att.status === 'half_day';
        let resolvedStatus = att.status;

        if (isHalfDay && isLate) {
          resolvedStatus = 'half_day_late';
        }

        const key = `${att.employee_id}_${att.date}`;
        if (!empAttDateMap.has(key)) {
          empAttDateMap.set(key, []);
        }
        empAttDateMap.get(key).push({
          date: att.date,
          schedule_id: att.schedule_id || null,
          status: resolvedStatus,
        });
      });

      // Pre-index holidays by date for O(1) lookup
      const holidaysByDate = new Map();
      holidaysList.forEach((h) => {
        if (!holidaysByDate.has(h.date)) holidaysByDate.set(h.date, []);
        holidaysByDate.get(h.date).push(h);
      });

      // Pre-index working day overrides by date for O(1) lookup
      const overridesByDate = new Map();
      workingDaysOverrides.forEach((o) => {
        if (!overridesByDate.has(o.date)) overridesByDate.set(o.date, []);
        overridesByDate.get(o.date).push(o);
      });

      // Helper function to build 1..lastDay matrix for an employee on a specific shift
      // Lightweight status mapping: daysMap[dayNum] = { status, holiday_name? }
      const buildEmployeeShiftDays = (emp, shift) => {
        const daysMap = {};

        for (let d = 1; d <= lastDay; d++) {
          const dateStr = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const dayObj = new Date(yearNum, monthNum - 1, d);
          const dayOfWeek = dayObj.getDay(); // 0 = Sun
          const dayStr = String(d).padStart(2, '0');

          // O(1) date holiday lookup
          const dayHolidays = holidaysByDate.get(dateStr) || [];
          const holidayMatch = dayHolidays.find(
            (h) => !h.branch_id || emp.branch_ids.includes(h.branch_id)
          );

          // O(1) date override lookup
          const isSunday = dayOfWeek === 0;
          const dayOverrides = overridesByDate.get(dateStr) || [];
          const isSpecialWorkingSunday =
            isSunday &&
            dayOverrides.some((o) => {
              if (o.employee_id && o.employee_id === emp.id) return true;
              if (!o.employee_id && (!o.branch_id || emp.branch_ids.includes(o.branch_id))) return true;
              return false;
            });

          // O(1) date punch lookup
          const dayAttList = empAttDateMap.get(`${emp.id}_${dateStr}`) || [];
          let dayRecord = dayAttList.find(
            (a) => (shift.id ? a.schedule_id === shift.id : true)
          ) || (dayAttList.length === 1 && !dayAttList[0].schedule_id ? dayAttList[0] : null);

          let resolvedDay = null;
          if (!dayRecord || dayRecord.status === 'not_marked' || dayRecord.status === '-') {
            if (holidayMatch) {
              resolvedDay = {
                status: 'holiday',
                holiday_name: holidayMatch.name,
              };
            } else if (isSunday && !isSpecialWorkingSunday) {
              resolvedDay = {
                status: 'holiday',
                holiday_name: 'Sunday Off',
              };
            } else {
              const todayStr = getTodayIST();
              const isPast =
                dateStr < todayStr ||
                (dateStr === todayStr &&
                  getCurrentMinutesIST() >= parseTimeToMinutes(shift?.end_time || '18:00:00'));

              resolvedDay = {
                status: isPast ? 'absent' : 'not_marked',
              };
            }
          } else {
            resolvedDay = {
              status: dayRecord.status,
              ...(holidayMatch ? { holiday_name: holidayMatch.name } : {}),
            };
          }

          daysMap[dayStr] = resolvedDay;
          daysMap[d] = resolvedDay;
        }

        return daysMap;
      };

      // 4. Build per-shift matrices
      // Determine effective shifts for each employee
      const employeeAssignedShiftsMap = new Map();
      employees.forEach((emp) => {
        const assigned = empShiftAssignmentsMap.get(emp.id) || [];
        const effective =
          assigned.length > 0
            ? assigned
            : [scheduleOverrideMap.get(emp.id) || defaultSchedule];
        employeeAssignedShiftsMap.set(emp.id, effective);
      });

      // Group employees by shift
      const shiftGroupsMap = new Map();
      allSchedules.forEach((sch) => {
        shiftGroupsMap.set(sch.id, {
          schedule_id: sch.id,
          schedule_name: sch.name || 'Shift Schedule',
          start_time: sch.start_time,
          end_time: sch.end_time,
          is_default: sch.is_default || false,
          employees: [],
        });
      });

      // Ensure default shift exists in map if not in allSchedules
      if (defaultSchedule.id && !shiftGroupsMap.has(defaultSchedule.id)) {
        shiftGroupsMap.set(defaultSchedule.id, {
          schedule_id: defaultSchedule.id,
          schedule_name: defaultSchedule.name || 'Day Shift',
          start_time: defaultSchedule.start_time,
          end_time: defaultSchedule.end_time,
          is_default: true,
          employees: [],
        });
      }

      employees.forEach((emp) => {
        const effectiveShifts = employeeAssignedShiftsMap.get(emp.id) || [defaultSchedule];
        effectiveShifts.forEach((shift) => {
          const shiftKey = shift.id || 'default';
          if (!shiftGroupsMap.has(shiftKey)) {
            shiftGroupsMap.set(shiftKey, {
              schedule_id: shift.id || null,
              schedule_name: shift.name || 'Shift Schedule',
              start_time: shift.start_time,
              end_time: shift.end_time,
              is_default: shift.is_default || false,
              employees: [],
            });
          }

          const daysMap = buildEmployeeShiftDays(emp, shift);
          shiftGroupsMap.get(shiftKey).employees.push({
            id: emp.id,
            employee_id: emp.id,
            name: emp.name,
            employee_name: emp.name,
            employee_code: emp.employee_code,
            department: emp.department,
            days_map: daysMap,
          });
        });
      });

      // Filter shift groups: include shifts that have assigned employees (or all if none)
      const shiftsResult = Array.from(shiftGroupsMap.values()).filter(
        (sg) => sg.employees.length > 0
      );

      // 5. Build flat result for backward compatibility
      const flatResult = employees.map((emp) => {
        const effectiveShifts = employeeAssignedShiftsMap.get(emp.id) || [defaultSchedule];
        const primaryShift = effectiveShifts[0] || defaultSchedule;
        const daysMap = buildEmployeeShiftDays(emp, primaryShift);
        return {
          id: emp.id,
          employee_id: emp.id,
          name: emp.name,
          employee_name: emp.name,
          employee_code: emp.employee_code,
          department: emp.department,
          days_map: daysMap,
        };
      });

      return res.status(200).json({
        success: true,
        month: monthNum,
        year: yearNum,
        holidays: holidaysList,
        shifts: shiftsResult,
        employees: flatResult,
      });
    } catch (err) {
      console.error('Attendance report error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/reports/payroll
   * Accessible by: owner only
   * Query: ?month=&year=&branch_id=
   */
  static async getPayrollReport(req, res) {
    try {
      if (req.user.role !== 'owner') {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only the owner can access organizational payroll reports' },
        });
      }

      const { month, year, branch_id } = req.query;

      if (!month || !year) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'month and year are required' },
        });
      }

      const monthNum = parseInt(month, 10);
      const yearNum = parseInt(year, 10);

      const { data: records, error } = await supabase
        .from('payroll')
        .select(`
          *,
          users!payroll_employee_id_fkey (
            name,
            employee_profiles (employee_code, department),
            branch_employee_assignments (branch_id), branch_managers (branch_id)
          )
        `)
        .eq('month', monthNum)
        .eq('year', yearNum);

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
          name: user?.name || 'Unknown',
          employee_name: user?.name || 'Unknown',
          employee_code: profile?.employee_code || '-',
          department: profile?.department || '-',
          branch_ids: branchIds,
          working_days: r.working_days,
          present_days: r.present_days,
          absent_days: r.absent_days,
          late_count: r.late_count,
          half_day_count: r.half_day_count,
          gross_salary: Number(r.gross_salary),
          total_deduction_amount: Number(r.total_deduction_amount),
          net_salary: Number(r.net_salary),
          status: r.status,
          deduction_breakdown: r.deduction_breakdown,
        };
      });

      if (branch_id) {
        formatted = formatted.filter((item) => item.branch_ids.includes(branch_id));
      }

      if (req.user.role === 'branch_manager' || req.user.role === 'admin') {
        const scopedIds = new Set(req.scopedBranchIds || []);
        formatted = formatted.filter((item) =>
          item.branch_ids.some((b) => scopedIds.has(b))
        );
      }

      const totalEmployees = formatted.length;
      const totalGross = Number(formatted.reduce((acc, r) => acc + r.gross_salary, 0).toFixed(2));
      const totalDeductions = Number(
        formatted.reduce((acc, r) => acc + r.total_deduction_amount, 0).toFixed(2)
      );
      const totalNet = Number(formatted.reduce((acc, r) => acc + r.net_salary, 0).toFixed(2));

      return res.status(200).json({
        success: true,
        month: monthNum,
        year: yearNum,
        total_employees: totalEmployees,
        total_gross: totalGross,
        total_deductions: totalDeductions,
        total_net: totalNet,
        summary: {
          total_employees: totalEmployees,
          total_gross: totalGross,
          total_deductions: totalDeductions,
          total_net: totalNet,
        },
        records: formatted,
        items: formatted,
        data: formatted,
      });
    } catch (err) {
      console.error('Payroll report error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/reports/export
   * Accessible by: owner, branch_manager
   * Query: ?type=attendance|payroll&month=&year=&branch_id=&format=pdf|excel
   */
  static async exportReport(req, res) {
    try {
      const { type = 'attendance', month, year, branch_id, format = 'excel' } = req.query;

      if (!month || !year) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'month and year are required' },
        });
      }

      const monthNum = parseInt(month, 10);
      const yearNum = parseInt(year, 10);

      if (type === 'attendance') {
        // Attendance Export (Excel or PDF)
        const startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
        const lastDay = new Date(yearNum, monthNum, 0).getDate();
        const endDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        let empQuery = supabase
          .from('users')
          .select(`
            id,
            name,
            employee_profiles (employee_code, department),
            branch_employee_assignments (branch_id), branch_managers (branch_id)
          `)
          .in('role', ['employee', 'branch_manager', 'admin'])
          .eq('is_active', true);

        const { data: rawEmployees } = await empQuery;
        let employees = (rawEmployees || []).map((e) => {
          const profile = Array.isArray(e.employee_profiles)
            ? e.employee_profiles[0]
            : e.employee_profiles;
          const empB = (e.branch_employee_assignments || []).map((b) => b.branch_id); const mgrB = (e.branch_managers || []).map((b) => b.branch_id); const branchIds = Array.from(new Set([...empB, ...mgrB]));
          return {
            id: e.id,
            name: e.name,
            employee_code: profile?.employee_code || '-',
            department: profile?.department || '-',
            branch_ids: branchIds,
          };
        });

        if (branch_id) {
          employees = employees.filter((e) => e.branch_ids.includes(branch_id));
        }

        if (req.user.role === 'branch_manager' || req.user.role === 'admin') {
          const scopedIds = new Set(req.scopedBranchIds || []);
          employees = employees.filter((e) => e.branch_ids.some((b) => scopedIds.has(b)));
        }

        const employeeIds = employees.map((e) => e.id);
        const [
          attendanceList,
          holRes,
          ovrRes,
          schedulesRes,
          shiftAssignmentsRes,
          overridesSchedulesRes,
        ] = await Promise.all([
          fetchMonthlyAttendanceRecords(employeeIds, startDate, endDate),
          supabase
            .from('holidays')
            .select('*')
            .gte('date', startDate)
            .lte('date', endDate),
          supabase
            .from('working_days_overrides')
            .select('*')
            .gte('date', startDate)
            .lte('date', endDate),
          supabase.from('work_schedules').select('*'),
          supabase
            .from('employee_shift_assignments')
            .select('employee_id, schedule_id')
            .in('employee_id', employeeIds.length > 0 ? employeeIds : ['00000000-0000-0000-0000-000000000000']),
          supabase
            .from('employee_schedule_overrides')
            .select('employee_id, schedule_id, work_schedules(*)')
            .in('employee_id', employeeIds.length > 0 ? employeeIds : ['00000000-0000-0000-0000-000000000000']),
        ]);

        const holidaysList = holRes.data || [];
        const workingDaysOverrides = ovrRes.data || [];
        const allSchedules = schedulesRes.data || [];
        const scheduleMap = new Map((allSchedules || []).map((s) => [s.id, s]));
        const defaultSchedule =
          (allSchedules || []).find((s) => s.is_default) ||
          allSchedules?.[0] || {
            id: null,
            start_time: '09:00:00',
            end_time: '18:00:00',
            name: 'Day Shift',
          };

        const empShiftAssignmentsMap = new Map();
        (shiftAssignmentsRes.data || []).forEach((sa) => {
          if (!empShiftAssignmentsMap.has(sa.employee_id)) {
            empShiftAssignmentsMap.set(sa.employee_id, []);
          }
          const sch = scheduleMap.get(sa.schedule_id);
          if (sch) empShiftAssignmentsMap.get(sa.employee_id).push(sch);
        });

        const scheduleOverrideMap = new Map();
        (overridesSchedulesRes.data || []).forEach((ov) => {
          if (ov.work_schedules) {
            scheduleOverrideMap.set(ov.employee_id, ov.work_schedules);
          }
        });

        const empAttendanceMap = new Map();
        (attendanceList || []).forEach((att) => {
          if (!empAttendanceMap.has(att.employee_id)) empAttendanceMap.set(att.employee_id, []);

          let isFlaggedLate =
            Boolean(att.is_flagged) &&
            (String(att.flag_reason || '').toLowerCase().includes('late') ||
              String(att.flag_reason || '').toLowerCase().includes('arrival'));
          let isLate = att.status === 'late' || isFlaggedLate;
          let isHalfDay = att.status === 'half_day';
          let resolvedStatus = att.status;

          if (isHalfDay && isLate) {
            resolvedStatus = 'half_day_late';
          }

          empAttendanceMap.get(att.employee_id).push({
            date: att.date,
            schedule_id: att.schedule_id || null,
            status: resolvedStatus,
          });
        });

        const buildEmployeeShiftDays = (emp, shift) => {
          const empAttList = empAttendanceMap.get(emp.id) || [];
          const daysMap = {};

          for (let d = 1; d <= lastDay; d++) {
            const dateStr = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayObj = new Date(yearNum, monthNum - 1, d);
            const isSunday = dayObj.getDay() === 0;

            const holidayMatch = holidaysList.find(
              (h) => h.date === dateStr && (!h.branch_id || emp.branch_ids.includes(h.branch_id))
            );

            const isSpecialWorkingSunday =
              isSunday &&
              workingDaysOverrides.some((o) => {
                if (o.date !== dateStr) return false;
                if (o.employee_id && o.employee_id === emp.id) return true;
                if (!o.employee_id && (!o.branch_id || emp.branch_ids.includes(o.branch_id))) return true;
                return false;
              });

            let record = empAttList.find(
              (a) => a.date === dateStr && (shift.id ? a.schedule_id === shift.id : true)
            );

            if (!record && empAttList.length > 0) {
              const matchesOnDate = empAttList.filter((a) => a.date === dateStr);
              if (matchesOnDate.length === 1 && !matchesOnDate[0].schedule_id) {
                record = matchesOnDate[0];
              }
            }

            let resolvedDay = null;
            if (!record || record.status === 'not_marked' || record.status === '-') {
              if (holidayMatch) {
                resolvedDay = { date: dateStr, status: 'holiday', holiday_name: holidayMatch.name };
              } else if (isSunday && !isSpecialWorkingSunday) {
                resolvedDay = { date: dateStr, status: 'holiday', holiday_name: 'Sunday Off' };
              } else {
                const todayStr = getTodayIST();
                const isPast =
                  dateStr < todayStr ||
                  (dateStr === todayStr &&
                    getCurrentMinutesIST() >= parseTimeToMinutes(shift?.end_time || '18:00:00'));

                resolvedDay = { date: dateStr, status: isPast ? 'absent' : 'not_marked' };
              }
            } else {
              resolvedDay = {
                date: dateStr,
                status: record.status,
                ...(holidayMatch ? { holiday_name: holidayMatch.name } : {}),
              };
            }

            daysMap[String(d).padStart(2, '0')] = resolvedDay;
            daysMap[d] = resolvedDay;
          }

          return daysMap;
        };

        const shiftGroupsMap = new Map();
        allSchedules.forEach((sch) => {
          shiftGroupsMap.set(sch.id, {
            schedule_id: sch.id,
            schedule_name: sch.name || 'Shift',
            employees: [],
          });
        });

        employees.forEach((emp) => {
          const assigned = empShiftAssignmentsMap.get(emp.id) || [];
          const effectiveShifts =
            assigned.length > 0
              ? assigned
              : [scheduleOverrideMap.get(emp.id) || defaultSchedule];

          effectiveShifts.forEach((shift) => {
            const shiftKey = shift.id || 'default';
            if (!shiftGroupsMap.has(shiftKey)) {
              shiftGroupsMap.set(shiftKey, {
                schedule_id: shift.id || null,
                schedule_name: shift.name || 'Shift',
                employees: [],
              });
            }

            const daysMap = buildEmployeeShiftDays(emp, shift);
            shiftGroupsMap.get(shiftKey).employees.push({
              name: emp.name,
              employee_name: emp.name,
              employee_code: emp.employee_code,
              department: emp.department,
              days_map: daysMap,
            });
          });
        });

        const exportShifts = Array.from(shiftGroupsMap.values()).filter(
          (sg) => sg.employees.length > 0
        );

        const excelBuffer = await generateAttendanceExcel(
          { shifts: exportShifts },
          monthNum,
          yearNum
        );
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename=attendance_report_${monthNum}_${yearNum}.xlsx`
        );
        return res.send(excelBuffer);
      } else if (type === 'payroll') {
        // Payroll Export (PDF or Excel) - Owner only
        if (req.user.role !== 'owner') {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Only the owner is authorized to export payroll reports' },
          });
        }

        const { data: records } = await supabase
          .from('payroll')
          .select(`
            *,
            users!payroll_employee_id_fkey (
              name,
              employee_profiles (employee_code, department),
              branch_employee_assignments (branch_id), branch_managers (branch_id)
            )
          `)
          .eq('month', monthNum)
          .eq('year', yearNum);

        let formatted = (records || []).map((r) => {
          const user = r.users;
          const profile = Array.isArray(user?.employee_profiles)
            ? user.employee_profiles[0]
            : user?.employee_profiles;
          const branchIds = (user?.branch_employee_assignments || []).map((b) => b.branch_id);

          return {
            id: r.id,
            name: user?.name || 'Unknown',
            employee_code: profile?.employee_code || '-',
            department: profile?.department || 'General',
            working_days: r.working_days ?? 26,
            present_days: r.present_days ?? 0,
            absent_days: r.absent_days ?? 0,
            half_day_count: r.half_day_count ?? 0,
            late_count: r.late_count ?? 0,
            advance_deduction: Number(r.advance_deduction || 0),
            gross_salary: Number(r.gross_salary),
            total_deduction_amount: Number(r.total_deduction_amount),
            deduction_breakdown: r.deduction_breakdown || [],
            net_salary: Number(r.net_salary),
            status: r.status || 'draft',
            branch_ids: branchIds,
          };
        });

        if (branch_id) {
          formatted = formatted.filter((item) => item.branch_ids.includes(branch_id));
        }

        if (req.user.role === 'branch_manager' || req.user.role === 'admin') {
          const scopedIds = new Set(req.scopedBranchIds || []);
          formatted = formatted.filter((item) =>
            item.branch_ids.some((b) => scopedIds.has(b))
          );
        }

        if (format === 'excel' || format === 'xlsx') {
          const excelBuffer = await generatePayrollExcel(formatted, monthNum, yearNum);
          res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          );
          res.setHeader(
            'Content-Disposition',
            `attachment; filename=payroll_report_${monthNum}_${yearNum}.xlsx`
          );
          return res.send(excelBuffer);
        }

        const pdfBuffer = await generatePayrollPDF(formatted, monthNum, yearNum);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename=payroll_report_${monthNum}_${yearNum}.pdf`
        );
        return res.send(pdfBuffer);
      } else {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_TYPE', message: "Type must be 'attendance' or 'payroll'" },
        });
      }
    } catch (err) {
      console.error('Export report error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }
}

export default ReportsController;
