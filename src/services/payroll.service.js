import { supabase } from '../db/supabase.js';
import { getEmployeeSchedule, isHoliday, computeLateMinutes, parseTimeToMinutes } from '../utils/schedule.js';

export class PayrollService {
  /**
   * Calculates the number of working days (Monday-Saturday + Working Sundays minus Branch Holidays) in a month.
   */
  static async getWorkingDaysCount(year, month, branchId = null, employeeId = null) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    // 1. Fetch holidays
    let holidayQuery = supabase
      .from('holidays')
      .select('date, branch_id')
      .gte('date', startDate)
      .lte('date', endDate);

    if (branchId) {
      holidayQuery = holidayQuery.or(`branch_id.eq.${branchId},branch_id.is.null`);
    } else {
      holidayQuery = holidayQuery.is('branch_id', null);
    }

    const { data: monthHolidays } = await holidayQuery;
    const holidayDates = new Set((monthHolidays || []).map((h) => h.date));

    // 2. Fetch working day overrides (working Sundays)
    let workingDaysOverrides = [];
    try {
      let overrideQuery = supabase
        .from('working_days_overrides')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate);

      const { data: overrides } = await overrideQuery;
      workingDaysOverrides = overrides || [];
    } catch {
      workingDaysOverrides = [];
    }

    let workingDays = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(year, month - 1, day);
      const dayOfWeek = dateObj.getDay(); // 0 is Sunday, 1..6 is Mon..Sat
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      let isWorkingDay = dayOfWeek !== 0; // Monday to Saturday

      // Check if this Sunday is marked as a working day override
      if (dayOfWeek === 0) {
        const isSpecialWorkingDay = workingDaysOverrides.some((o) => {
          if (o.date !== dateStr) return false;
          if (employeeId && o.employee_id && o.employee_id === employeeId) return true;
          if (!o.employee_id && (!o.branch_id || o.branch_id === branchId)) return true;
          return false;
        });

        if (isSpecialWorkingDay) {
          isWorkingDay = true;
        }
      }

      // Paid holidays are part of the total payable working days in the month
      if (isWorkingDay) {
        workingDays++;
      }
    }

    return workingDays > 0 ? workingDays : 26;
  }

  /**
   * Generates payroll for specified employees or all active employees for a given month and year.
   * Only run when owner requests payslip generation.
   * @param {number} month
   * @param {number} year
   * @param {Array} employeeIds
   * @param {'present'|'absent'} future_days_treatment
   */
  static async generatePayroll(month, year, employeeIds = [], future_days_treatment = 'present') {
    // 1 & 2. Fetch active deduction policies and targeted employees concurrently
    let userQuery = supabase
      .from('users')
      .select(`
        id,
        name,
        email,
        employee_profiles (
          id,
          employee_code,
          monthly_salary,
          department
        ),
        branch_employee_assignments (
          branch_id
        ),
        branch_managers (
          branch_id
        )
      `)
      .in('role', ['employee', 'branch_manager'])
      .eq('is_active', true);

    if (employeeIds && employeeIds.length > 0) {
      userQuery = userQuery.in('id', employeeIds);
    }

    const [policiesRes, empRes] = await Promise.all([
      supabase.from('deduction_policies').select('*').eq('is_active', true),
      userQuery,
    ]);

    if (empRes.error) {
      throw { status: 500, code: 'DB_ERROR', message: empRes.error.message };
    }

    const policies = policiesRes.data || [];
    const employees = empRes.data || [];

    if (!employees || employees.length === 0) {
      return [];
    }

    const latePolicies = (policies || [])
      .filter((p) => p.condition_type === 'late_arrival')
      .sort((a, b) => (Number(b.threshold_minutes) || 0) - (Number(a.threshold_minutes) || 0));

    const earlyPolicies = (policies || [])
      .filter((p) => p.condition_type === 'early_departure')
      .sort((a, b) => (Number(b.threshold_minutes) || 0) - (Number(a.threshold_minutes) || 0));

    const allEmpIds = employees.map((e) => e.id);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    // 3. Concurrently fetch all auxiliary datasets in parallel
    const [
      existingPayrollsRes,
      workingDaysOverridesRes,
      allSchedulesRes,
      scheduleOverridesRes,
      shiftAssignmentsRes,
      monthHolidaysRes,
      advancesRes,
      attendanceRes,
    ] = await Promise.all([
      supabase
        .from('payroll')
        .select('*')
        .in('employee_id', allEmpIds)
        .eq('month', month)
        .eq('year', year),
      supabase
        .from('working_days_overrides')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate),
      supabase.from('work_schedules').select('*'),
      supabase
        .from('employee_schedule_overrides')
        .select('employee_id, schedule_id')
        .in('employee_id', allEmpIds),
      supabase
        .from('employee_shift_assignments')
        .select('employee_id, schedule_id, salary')
        .in('employee_id', allEmpIds),
      supabase
        .from('holidays')
        .select('date, name, branch_id')
        .gte('date', startDate)
        .lte('date', endDate),
      supabase
        .from('advance_salaries')
        .select('*')
        .in('employee_id', allEmpIds)
        .or('status.eq.approved,status.eq.deducted'),
      supabase
        .from('attendance')
        .select('*')
        .in('employee_id', allEmpIds)
        .gte('date', startDate)
        .lte('date', endDate)
        .limit(5000),
    ]);

    const workingDaysOverrides = workingDaysOverridesRes.data || [];
    const allSchedules = allSchedulesRes.data || [];
    const defaultSchedule =
      (allSchedules || []).find((s) => s.is_default) ||
      (allSchedules || [])[0] || {
        id: null,
        name: 'Standard Shift',
        start_time: '09:00:00',
        end_time: '18:00:00',
      };
    const scheduleMap = new Map((allSchedules || []).map((s) => [s.id, s]));

    const scheduleOverrides = scheduleOverridesRes.data || [];
    const empScheduleOverrideMap = new Map(
      (scheduleOverrides || []).map((o) => [o.employee_id, scheduleMap.get(o.schedule_id)])
    );

    const shiftAssignments = shiftAssignmentsRes.data || [];
    const empShiftAssignmentsMap = new Map();
    (shiftAssignments || []).forEach((sa) => {
      if (!empShiftAssignmentsMap.has(sa.employee_id)) {
        empShiftAssignmentsMap.set(sa.employee_id, []);
      }
      const sch = scheduleMap.get(sa.schedule_id);
      if (sch) {
        empShiftAssignmentsMap.get(sa.employee_id).push({
          schedule_id: sa.schedule_id,
          salary: Number(sa.salary) || 0,
          schedule: sch,
        });
      }
    });

    const allHolidays = monthHolidaysRes.data || [];

    const advances = advancesRes.data || [];
    const approvedAdvances = (advances || []).filter(
      (a) =>
        (!a.target_month && !a.target_year) ||
        (Number(a.target_month) === Number(month) && Number(a.target_year) === Number(year))
    );

    const empAdvancesMap = new Map();
    approvedAdvances.forEach((adv) => {
      if (!empAdvancesMap.has(adv.employee_id)) {
        empAdvancesMap.set(adv.employee_id, []);
      }
      empAdvancesMap.get(adv.employee_id).push(adv);
    });

    let attendanceRecords = attendanceRes.data || [];
    if (attendanceRes.error) {
      throw { status: 500, code: 'DB_ERROR', message: attendanceRes.error.message };
    }

    // If attendance exceeded 5000 records, fetch remaining pages
    if (attendanceRecords.length >= 5000) {
      let attOffset = 5000;
      const attPageSize = 1000;
      while (true) {
        const { data: pageData, error: attError } = await supabase
          .from('attendance')
          .select('*')
          .in('employee_id', allEmpIds)
          .gte('date', startDate)
          .lte('date', endDate)
          .range(attOffset, attOffset + attPageSize - 1);

        if (attError) break;
        attendanceRecords = attendanceRecords.concat(pageData || []);
        if (!pageData || pageData.length < attPageSize) break;
        attOffset += attPageSize;
      }
    }

    const empAttendanceMap = new Map();
    allEmpIds.forEach((id) => empAttendanceMap.set(id, new Map()));
    (attendanceRecords || []).forEach((r) => {
      if (empAttendanceMap.has(r.employee_id)) {
        const empMap = empAttendanceMap.get(r.employee_id);
        if (r.schedule_id) {
          empMap.set(`${r.date}_${r.schedule_id}`, r);
        }
        if (!empMap.has(r.date)) {
          empMap.set(r.date, r);
        }
      }
    });

    const payrollResults = [];
    const payrollToUpsert = [];
    const empMetaMap = new Map();

    for (const emp of employees) {
      const employeeId = emp.id;
      empMetaMap.set(employeeId, {
        name: emp.name,
        code: emp.employee_profiles?.employee_code,
      });

      // Payroll generation will always produce draft records

      const monthlySalary = Number(emp.employee_profiles?.monthly_salary || 0);
      const primaryBranchId =
        emp.branch_employee_assignments?.[0]?.branch_id ||
        emp.branch_managers?.[0]?.branch_id ||
        null;

      // Effective schedule
      const schedule = empScheduleOverrideMap.get(employeeId) || defaultSchedule;
      const startMin = parseTimeToMinutes(schedule.start_time);
      let endMin = parseTimeToMinutes(schedule.end_time);
      if (endMin <= startMin) endMin += 24 * 60;
      const shiftMinutes = Math.max(60, endMin - startMin);

      // Assigned shifts for this employee (multi-shift or single shift fallback)
      let assignedShifts = empShiftAssignmentsMap.get(employeeId) || [];
      if (assignedShifts.length === 0) {
        assignedShifts = [
          {
            schedule_id: schedule.id,
            salary: monthlySalary,
            schedule: schedule,
          },
        ];
      }

      // Branch-specific & global holidays
      const holidayDates = new Set(
        allHolidays
          .filter((h) => !h.branch_id || h.branch_id === primaryBranchId)
          .map((h) => h.date)
      );

      const attendanceMap = empAttendanceMap.get(employeeId) || new Map();

      // Working days calculation
      let workingDays = 0;
      const employeeWorkingDates = new Set();

      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, month - 1, d);
        const dayOfWeek = dateObj.getDay(); // 0 = Sun, 1..6 = Mon..Sat
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

        let isWorking = dayOfWeek !== 0; // Mon to Sat

        if (dayOfWeek === 0) {
          const isSpecialWorkingSunday = workingDaysOverrides.some((o) => {
            if (o.date !== dateStr) return false;
            if (o.employee_id && o.employee_id === employeeId) return true;
            if (!o.employee_id && (!o.branch_id || o.branch_id === primaryBranchId)) return true;
            return false;
          });

          if (isSpecialWorkingSunday) {
            isWorking = true;
          }
        }

        if (isWorking) {
          employeeWorkingDates.add(dateStr);
          workingDays++;
        }
      }

      if (workingDays === 0) workingDays = 26;
      const perDaySalary = workingDays > 0 ? Math.round(monthlySalary / workingDays) : 0;

      const now = new Date();
      const currentMonthStr = String(now.getUTCMonth() + 1);
      const currentYearStr = String(now.getUTCFullYear());
      const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
      const currentUtcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
      const currentIstMins = (currentUtcMins + 330) % 1440;

      // Determine date cutoff: if current month & year, only evaluate up to todayStr
      // If past month, evaluate all month days. If future month, cutoff is before month start.
      const isCurrentMonth = Number(month) === (now.getMonth() + 1) && Number(year) === now.getFullYear();
      const isFutureMonth = Number(year) > now.getFullYear() || (Number(year) === now.getFullYear() && Number(month) > (now.getMonth() + 1));

      let presentDays = 0;
      let absentDays = 0;
      let lateCount = 0;
      let totalLateMinutes = 0;
      let halfDayCount = 0;
      let totalDeductions = 0;
      let totalEarnedSalary = 0;
      let totalMonthNetFromDays = 0;
      const deductionBreakdown = [];
      const dailyRecords = [];
      const shiftWeight = 1 / assignedShifts.length;

      // Sort dates chronologically
      const sortedWorkingDates = Array.from(employeeWorkingDates).sort();

      for (const dateStr of sortedWorkingDates) {
        const isFutureDate = (isCurrentMonth && dateStr > todayStr) || isFutureMonth;
        const isToday = isCurrentMonth && dateStr === todayStr;
        const isHolidayDate = holidayDates.has(dateStr);
        const holidayObj = allHolidays.find((h) => h.date === dateStr);

        let dayBasePay = 0;
        let dayDeductions = 0;
        let dayNetPay = 0;
        const dayShifts = [];

        for (const shiftItem of assignedShifts) {
          const shiftSchedule = shiftItem.schedule;
          const shiftSalary = shiftItem.salary;
          const shiftDailyRate = workingDays > 0 ? Math.round(shiftSalary / workingDays) : 0;
          let grossShiftMinutes = parseTimeToMinutes(shiftSchedule.end_time) - parseTimeToMinutes(shiftSchedule.start_time);
          if (grossShiftMinutes <= 0) grossShiftMinutes += 1440;

          let breakMinutes = 0;
          if (shiftSchedule.has_break && shiftSchedule.break_start_time && shiftSchedule.break_end_time) {
            let bStart = parseTimeToMinutes(shiftSchedule.break_start_time);
            let bEnd = parseTimeToMinutes(shiftSchedule.break_end_time);
            if (bEnd <= bStart) bEnd += 1440;
            breakMinutes = Math.max(0, bEnd - bStart);
          }

          // Effective working minutes (e.g. 9h shift - 1h break = 8h / 480 mins)
          const shiftMinutes = Math.max(60, grossShiftMinutes - breakMinutes);

          let shiftTimeStr = `${(shiftSchedule.start_time || '').slice(0, 5)} - ${(shiftSchedule.end_time || '').slice(0, 5)}`;
          if (shiftSchedule.has_break && shiftSchedule.break_start_time && shiftSchedule.break_end_time) {
            shiftTimeStr += ` · Break: ${(shiftSchedule.break_start_time || '').slice(0, 5)}-${(shiftSchedule.break_end_time || '').slice(0, 5)}`;
          }

          dayBasePay += shiftDailyRate;

          // Paid Holiday case
          if (isHolidayDate) {
            dayShifts.push({
              schedule_id: shiftSchedule.id,
              shift_name: shiftSchedule.name || 'Shift',
              shift_time: shiftTimeStr,
              has_break: !!shiftSchedule.has_break,
              break_time: shiftSchedule.has_break ? `${(shiftSchedule.break_start_time || '').slice(0, 5)} - ${(shiftSchedule.break_end_time || '').slice(0, 5)}` : null,
              working_hours: Number((shiftMinutes / 60).toFixed(1)),
              base_pay: shiftDailyRate,
              status: 'holiday',
              clock_in: null,
              clock_out: null,
              late_minutes: 0,
              is_manual: false,
              deductions: [],
              shift_net_pay: shiftDailyRate,
            });
            dayNetPay += shiftDailyRate;
            totalEarnedSalary += shiftDailyRate;
            continue;
          }

          // Future working day case (evaluated based on owner selection)
          if (isFutureDate) {
            if (future_days_treatment === 'present') {
              presentDays += shiftWeight;
              totalEarnedSalary += shiftDailyRate;
              dayNetPay += shiftDailyRate;
              dayShifts.push({
                schedule_id: shiftSchedule.id,
                shift_name: shiftSchedule.name || 'Shift',
                shift_time: shiftTimeStr,
                has_break: !!shiftSchedule.has_break,
                break_time: shiftSchedule.has_break ? `${(shiftSchedule.break_start_time || '').slice(0, 5)} - ${(shiftSchedule.break_end_time || '').slice(0, 5)}` : null,
                working_hours: Number((shiftMinutes / 60).toFixed(1)),
                base_pay: shiftDailyRate,
                status: 'present',
                is_projected: true,
                clock_in: null,
                clock_out: null,
                late_minutes: 0,
                is_manual: false,
                deductions: [],
                shift_net_pay: shiftDailyRate,
              });
            } else {
              absentDays += shiftWeight;
              const absentAmount = shiftDailyRate;
              dayDeductions += absentAmount;
              totalDeductions += absentAmount;
              const dItem = {
                date: dateStr,
                type: 'absent',
                is_projected: true,
                reason: assignedShifts.length > 1 ? `Absent (${shiftSchedule.name}) • Future Day` : 'Absent • Future Day',
                policy_name: assignedShifts.length > 1 ? `Full Day Absent (${shiftSchedule.name})` : 'Full Day Absent',
                amount: absentAmount,
              };
              deductionBreakdown.push(dItem);
              dayShifts.push({
                schedule_id: shiftSchedule.id,
                shift_name: shiftSchedule.name || 'Shift',
                shift_time: shiftTimeStr,
                has_break: !!shiftSchedule.has_break,
                break_time: shiftSchedule.has_break ? `${(shiftSchedule.break_start_time || '').slice(0, 5)} - ${(shiftSchedule.break_end_time || '').slice(0, 5)}` : null,
                working_hours: Number((shiftMinutes / 60).toFixed(1)),
                base_pay: shiftDailyRate,
                status: 'absent',
                is_projected: true,
                clock_in: null,
                clock_out: null,
                late_minutes: 0,
                is_manual: false,
                deductions: [dItem],
                shift_net_pay: 0,
              });
            }
            continue;
          }

          // Lookup attendance for this specific shift
          let record = attendanceMap.get(`${dateStr}_${shiftSchedule.id}`);
          if (!record && assignedShifts.length === 1) {
            record = attendanceMap.get(dateStr);
          } else if (!record && attendanceMap.has(dateStr)) {
            const fallback = attendanceMap.get(dateStr);
            if (!fallback.schedule_id || fallback.schedule_id === shiftSchedule.id) {
              record = fallback;
            }
          }

          // If it is today and no punch yet (or marked absent):
          // Treat based on owner's chosen future_days_treatment setting!
          if (isToday && (!record || record.status === 'absent')) {
            if (future_days_treatment === 'present') {
              presentDays += shiftWeight;
              totalEarnedSalary += shiftDailyRate;
              dayNetPay += shiftDailyRate;
              dayShifts.push({
                schedule_id: shiftSchedule.id,
                shift_name: shiftSchedule.name || 'Shift',
                shift_time: shiftTimeStr,
                has_break: !!shiftSchedule.has_break,
                break_time: shiftSchedule.has_break
                  ? `${(shiftSchedule.break_start_time || '').slice(0, 5)} - ${(shiftSchedule.break_end_time || '').slice(0, 5)}`
                  : null,
                working_hours: Number((shiftMinutes / 60).toFixed(1)),
                base_pay: shiftDailyRate,
                status: 'present',
                is_projected: true,
                clock_in: null,
                clock_out: null,
                late_minutes: 0,
                is_manual: false,
                deductions: [],
                shift_net_pay: shiftDailyRate,
              });
            } else {
              absentDays += shiftWeight;
              const absentAmount = shiftDailyRate;
              dayDeductions += absentAmount;
              totalDeductions += absentAmount;
              const dItem = {
                date: dateStr,
                type: 'absent',
                is_projected: true,
                reason: assignedShifts.length > 1 ? `Absent (${shiftSchedule.name}) • Today` : 'Absent • Today',
                policy_name: assignedShifts.length > 1 ? `Full Day Absent (${shiftSchedule.name})` : 'Full Day Absent',
                amount: absentAmount,
              };
              deductionBreakdown.push(dItem);
              dayShifts.push({
                schedule_id: shiftSchedule.id,
                shift_name: shiftSchedule.name || 'Shift',
                shift_time: shiftTimeStr,
                has_break: !!shiftSchedule.has_break,
                break_time: shiftSchedule.has_break
                  ? `${(shiftSchedule.break_start_time || '').slice(0, 5)} - ${(shiftSchedule.break_end_time || '').slice(0, 5)}`
                  : null,
                working_hours: Number((shiftMinutes / 60).toFixed(1)),
                base_pay: shiftDailyRate,
                status: 'absent',
                is_projected: true,
                clock_in: null,
                clock_out: null,
                late_minutes: 0,
                is_manual: false,
                deductions: [dItem],
                shift_net_pay: 0,
              });
            }
            continue;
          }

          const shiftDeductionsList = [];
          let shiftDeductionSum = 0;
          let shiftNet = 0;

          if (!record || record.status === 'absent') {
            absentDays += shiftWeight;
            const absentAmount = shiftDailyRate;
            if (absentAmount > 0) {
              shiftDeductionSum += absentAmount;
              totalDeductions += absentAmount;
              const dItem = {
                date: dateStr,
                type: 'absent',
                reason: assignedShifts.length > 1 ? `Absent (${shiftSchedule.name})` : 'Absent',
                policy_name: assignedShifts.length > 1 ? `Full Day Absent (${shiftSchedule.name})` : 'Full Day Absent',
                amount: absentAmount,
              };
              shiftDeductionsList.push(dItem);
              deductionBreakdown.push(dItem);
            }
            shiftNet = 0;

            dayShifts.push({
              schedule_id: shiftSchedule.id,
              shift_name: shiftSchedule.name || 'Shift',
              shift_time: shiftTimeStr,
              has_break: !!shiftSchedule.has_break,
              break_time: shiftSchedule.has_break ? `${(shiftSchedule.break_start_time || '').slice(0, 5)} - ${(shiftSchedule.break_end_time || '').slice(0, 5)}` : null,
              working_hours: Number((shiftMinutes / 60).toFixed(1)),
              base_pay: shiftDailyRate,
              status: 'absent',
              clock_in: null,
              clock_out: null,
              late_minutes: 0,
              is_manual: false,
              deductions: shiftDeductionsList,
              shift_net_pay: shiftNet,
            });
          } else {
            // Present or Half Day (either explicitly marked, or worked less than half the shift duration)
            let isHalfDayRecord = record?.status === 'half_day';
            if (!isHalfDayRecord && record?.clock_in_time && record?.clock_out_time && shiftMinutes > 0) {
              const inDate = new Date(record.clock_in_time);
              const outDate = new Date(record.clock_out_time);
              const workedMins = Math.floor((outDate.getTime() - inDate.getTime()) / 60000);
              if (workedMins < shiftMinutes / 2) {
                isHalfDayRecord = true;
              }
            }

            let shiftEarned = shiftDailyRate;

            if (isHalfDayRecord) {
              halfDayCount++;
              presentDays += shiftWeight * 0.5;
              absentDays += shiftWeight * 0.5;
              const halfDayDeduction = Math.round(shiftDailyRate / 2);
              shiftEarned = Math.max(0, shiftDailyRate - halfDayDeduction);
              totalEarnedSalary += shiftEarned;

              if (halfDayDeduction > 0) {
                shiftDeductionSum += halfDayDeduction;
                totalDeductions += halfDayDeduction;
                const dItem = {
                  date: dateStr,
                  type: 'half_day',
                  reason: assignedShifts.length > 1 ? `Half Day (${shiftSchedule.name})` : 'Half Day',
                  policy_name: assignedShifts.length > 1 ? `Half Day (${shiftSchedule.name})` : 'Half Day',
                  amount: halfDayDeduction,
                };
                shiftDeductionsList.push(dItem);
                deductionBreakdown.push(dItem);
              }
            } else {
              presentDays += shiftWeight;
              totalEarnedSalary += shiftDailyRate;
            }

            // Late Arrival Policy Check
            const lateMins = record.clock_in_time
              ? computeLateMinutes(record.clock_in_time, shiftSchedule.start_time)
              : 0;

            if (lateMins > 0) {
              totalLateMinutes += lateMins;
            }

            const applicableLatePolicies = latePolicies
              .filter((p) => !p.schedule_id || (shiftSchedule.id && p.schedule_id === shiftSchedule.id))
              .sort((a, b) => (Number(b.threshold_minutes) || 0) - (Number(a.threshold_minutes) || 0));

            const matchedLatePolicy = applicableLatePolicies.find(
              (p) => lateMins > (Number(p.threshold_minutes) || 0)
            ) || null;

            if (matchedLatePolicy && lateMins > (Number(matchedLatePolicy.threshold_minutes) || 0)) {
              lateCount++;
              let lateDeduction = 0;
              if (matchedLatePolicy.deduction_type === 'fixed_minutes') {
                const deductionMins = matchedLatePolicy.deduction_minutes || 30;
                lateDeduction = Math.round((deductionMins / shiftMinutes) * shiftDailyRate);
              } else if (matchedLatePolicy.deduction_type === 'half_day') {
                if (!isHalfDayRecord) {
                  lateDeduction = Math.round(shiftDailyRate / 2);
                }
              } else if (matchedLatePolicy.deduction_type === 'full_day') {
                lateDeduction = Math.max(0, shiftDailyRate - shiftDeductionSum);
              }

              if (lateDeduction > 0) {
                const lateAmount = lateDeduction;
                shiftDeductionSum += lateAmount;
                totalDeductions += lateAmount;
                const dItem = {
                  date: dateStr,
                  type: 'late_arrival',
                  reason: assignedShifts.length > 1 ? `${lateMins} min late (${shiftSchedule.name})` : `${lateMins} min late`,
                  policy_name: matchedLatePolicy?.name || 'Late Arrival Policy',
                  amount: lateAmount,
                };
                shiftDeductionsList.push(dItem);
                deductionBreakdown.push(dItem);
              }
            }

            shiftNet = Math.max(0, Math.round(shiftDailyRate - shiftDeductionSum));

            dayShifts.push({
              schedule_id: shiftSchedule.id,
              shift_name: shiftSchedule.name || 'Shift',
              shift_time: shiftTimeStr,
              has_break: !!shiftSchedule.has_break,
              break_time: shiftSchedule.has_break ? `${(shiftSchedule.break_start_time || '').slice(0, 5)} - ${(shiftSchedule.break_end_time || '').slice(0, 5)}` : null,
              working_hours: Number((shiftMinutes / 60).toFixed(1)),
              base_pay: shiftDailyRate,
              status: isHalfDayRecord ? 'half_day' : 'present',
              clock_in: record.clock_in_time || null,
              clock_out: record.clock_out_time || null,
              lunch_start_time: record.lunch_start_time || null,
              lunch_end_time: record.lunch_end_time || null,
              lunch_duration_minutes: record.lunch_duration_minutes || null,
              is_on_lunch: Boolean(record.lunch_start_time && !record.lunch_end_time),
              late_minutes: lateMins,
              is_manual: record.is_manual || false,
              deductions: shiftDeductionsList,
              shift_net_pay: shiftNet,
            });
          }

          dayDeductions += shiftDeductionSum;
          dayNetPay += shiftNet;
        }

        if (isHolidayDate) {
          presentDays += 1;
        }

        if (dayShifts.length > 0) {
          dailyRecords.push({
            date: dateStr,
            is_holiday: isHolidayDate,
            holiday_name: holidayObj?.name || null,
            day_base_pay: Math.round(dayBasePay),
            day_deductions: Math.round(dayDeductions),
            day_net_pay: Math.round(dayNetPay),
            shifts: dayShifts,
          });
          totalMonthNetFromDays += dayNetPay;
        }
      }

      // Process Advance Salary Deductions for this employee
      const empAdvances = empAdvancesMap.get(employeeId) || [];
      let advanceDeductionTotal = 0;
      empAdvances.forEach((adv) => {
        const advAmount = Math.round(Number(adv.amount || 0));
        advanceDeductionTotal += advAmount;
        const advDate = adv.created_at ? adv.created_at.split('T')[0] : `${year}-${String(month).padStart(2, '0')}-01`;
        deductionBreakdown.push({
          date: advDate,
          type: 'advance_salary',
          advance_id: adv.id,
          reason: 'Salary Advance',
          policy_name: adv.reason || 'Advance Salary',
          amount: advAmount,
        });
      });

      const grossSalary = Math.round(monthlySalary);
      const earnedSalary = Math.round(totalEarnedSalary);
      const totalDeductionsWithAdvance = Math.round(totalDeductions + advanceDeductionTotal);
      // Net salary = sum of all daily net pays minus advance salary deductions
      const netSalary = Math.max(0, Math.round(totalMonthNetFromDays - advanceDeductionTotal));

      const autoSnapshot = {
        gross_salary: grossSalary,
        earned_salary: earnedSalary,
        total_deduction_amount: totalDeductionsWithAdvance,
        advance_deduction: Math.round(advanceDeductionTotal),
        net_salary: netSalary,
        working_days: workingDays,
        present_days: Math.round(presentDays),
        absent_days: Math.round(absentDays),
        late_count: lateCount,
        total_late_minutes: totalLateMinutes,
        half_day_count: halfDayCount,
        deduction_breakdown: deductionBreakdown,
        daily_records: dailyRecords,
      };

      payrollToUpsert.push({
        employee_id: employeeId,
        month,
        year,
        working_days: workingDays,
        present_days: Math.round(presentDays),
        absent_days: Math.round(absentDays),
        late_count: lateCount,
        total_late_minutes: totalLateMinutes,
        half_day_count: halfDayCount,
        total_deduction_amount: totalDeductionsWithAdvance,
        advance_deduction: Math.round(advanceDeductionTotal),
        deduction_breakdown: deductionBreakdown,
        daily_records: dailyRecords,
        gross_salary: grossSalary,
        earned_salary: earnedSalary,
        net_salary: netSalary,
        status: 'draft',
        is_manually_edited: false,
        auto_calculated_snapshot: autoSnapshot,
        generated_at: new Date().toISOString(),
      });
    }

    // 10. Upsert all calculated payroll records in batch
    if (payrollToUpsert.length > 0) {
      const { data: savedPayrolls, error: saveError } = await supabase
        .from('payroll')
        .upsert(payrollToUpsert, { onConflict: 'employee_id,month,year' })
        .select();

      if (saveError) {
        console.error('Error saving batch payroll:', saveError);
        throw { status: 500, code: 'DB_ERROR', message: saveError.message };
      }

      // Mark applied advance salaries as deducted and link them to their payroll records
      const advanceUpdates = [];
      (savedPayrolls || []).forEach((p) => {
        const meta = empMetaMap.get(p.employee_id) || {};
        payrollResults.push({
          ...p,
          employee_name: meta.name,
          employee_code: meta.code,
        });

        const empAdvances = empAdvancesMap.get(p.employee_id) || [];
        empAdvances.forEach((adv) => {
          advanceUpdates.push({
            id: adv.id,
            payroll_id: p.id,
          });
        });
      });

      if (advanceUpdates.length > 0) {
        const nowIso = new Date().toISOString();
        await Promise.allSettled(
          advanceUpdates.map((update) =>
            supabase
              .from('advance_salaries')
              .update({
                status: 'deducted',
                payroll_id: update.payroll_id,
                deducted_at: nowIso,
              })
              .eq('id', update.id)
          )
        );
      }
    }

    return payrollResults;
  }

  /**
   * Allows owner to manually update amounts, attendance days, and line items on a draft payroll.
   */
  static async updateDraftPayroll(id, updates, userId) {
    // 1. Fetch current payroll record
    const { data: current, error: fetchErr } = await supabase
      .from('payroll')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !current) {
      throw { status: 404, code: 'NOT_FOUND', message: 'Payroll record not found' };
    }

    if (current.status === 'finalized') {
      throw {
        status: 400,
        code: 'PAYROLL_ALREADY_FINALIZED',
        message: 'Cannot edit finalized payroll. Only draft payroll can be edited.',
      };
    }

    // Allowed updatable fields
    const payload = {
      is_manually_edited: true,
      edited_by: userId,
      edited_at: new Date().toISOString(),
    };

    if (updates.gross_salary !== undefined) payload.gross_salary = Math.round(Number(updates.gross_salary) || 0);
    if (updates.earned_salary !== undefined) payload.earned_salary = Math.round(Number(updates.earned_salary) || 0);
    if (updates.total_deduction_amount !== undefined)
      payload.total_deduction_amount = Math.round(Number(updates.total_deduction_amount) || 0);
    if (updates.advance_deduction !== undefined) payload.advance_deduction = Math.round(Number(updates.advance_deduction) || 0);
    if (updates.net_salary !== undefined) payload.net_salary = Math.max(0, Math.round(Number(updates.net_salary) || 0));
    if (updates.working_days !== undefined) payload.working_days = Number(updates.working_days);
    if (updates.present_days !== undefined) payload.present_days = Number(updates.present_days);
    if (updates.absent_days !== undefined) payload.absent_days = Number(updates.absent_days);
    if (updates.half_day_count !== undefined) payload.half_day_count = Number(updates.half_day_count);
    if (updates.late_count !== undefined) payload.late_count = Number(updates.late_count);
    if (updates.total_late_minutes !== undefined)
      payload.total_late_minutes = Number(updates.total_late_minutes);
    if (updates.deduction_breakdown !== undefined) payload.deduction_breakdown = updates.deduction_breakdown;
    if (updates.daily_records !== undefined) payload.daily_records = updates.daily_records;
    if (updates.admin_notes !== undefined && updates.admin_notes !== null && String(updates.admin_notes).trim() !== '') {
      payload.admin_notes = String(updates.admin_notes).trim();
    }

    // Preserve original auto snapshot if not already present
    if (!current.auto_calculated_snapshot) {
      payload.auto_calculated_snapshot = {
        gross_salary: current.gross_salary,
        earned_salary: current.earned_salary,
        total_deduction_amount: current.total_deduction_amount,
        advance_deduction: current.advance_deduction,
        net_salary: current.net_salary,
        working_days: current.working_days,
        present_days: current.present_days,
        absent_days: current.absent_days,
        late_count: current.late_count,
        total_late_minutes: current.total_late_minutes,
        half_day_count: current.half_day_count,
        deduction_breakdown: current.deduction_breakdown,
        daily_records: current.daily_records,
      };
    }

    let { data: updated, error: updateErr } = await supabase
      .from('payroll')
      .update(payload)
      .eq('id', id)
      .select(`
        *,
        users!payroll_employee_id_fkey (
          id,
          name,
          employee_profiles (
            employee_code,
            department
          )
        )
      `)
      .single();

    if (updateErr && (updateErr.message?.includes('admin_notes') || updateErr.code === 'PGRST204')) {
      delete payload.admin_notes;
      const retryRes = await supabase
        .from('payroll')
        .update(payload)
        .eq('id', id)
        .select(`
          *,
          users!payroll_employee_id_fkey (
            id,
            name,
            employee_profiles (
              employee_code,
              department
            )
          )
        `)
        .single();
      updated = retryRes.data;
      updateErr = retryRes.error;
    }

    if (updateErr) {
      console.error('Error updating draft payroll:', updateErr);
      throw { status: 500, code: 'DB_ERROR', message: updateErr.message };
    }

    return updated;
  }

  /**
   * Reverts manual edits on a draft payroll back to the auto-calculated snapshot.
   */
  static async resetDraftPayroll(id) {
    const { data: current, error: fetchErr } = await supabase
      .from('payroll')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !current) {
      throw { status: 404, code: 'NOT_FOUND', message: 'Payroll record not found' };
    }

    if (current.status === 'finalized') {
      throw {
        status: 400,
        code: 'PAYROLL_ALREADY_FINALIZED',
        message: 'Cannot reset finalized payroll.',
      };
    }

    const snapshot = current.auto_calculated_snapshot;
    if (!snapshot) {
      throw {
        status: 400,
        code: 'NO_SNAPSHOT',
        message: 'No auto-calculated snapshot found to restore.',
      };
    }

    const payload = {
      gross_salary: snapshot.gross_salary,
      earned_salary: snapshot.earned_salary,
      total_deduction_amount: snapshot.total_deduction_amount,
      advance_deduction: snapshot.advance_deduction ?? 0,
      net_salary: snapshot.net_salary,
      working_days: snapshot.working_days,
      present_days: snapshot.present_days,
      absent_days: snapshot.absent_days,
      late_count: snapshot.late_count,
      total_late_minutes: snapshot.total_late_minutes,
      half_day_count: snapshot.half_day_count,
      deduction_breakdown: snapshot.deduction_breakdown,
      daily_records: snapshot.daily_records,
      is_manually_edited: false,
      edited_by: null,
      edited_at: null,
    };

    const { data: updated, error: updateErr } = await supabase
      .from('payroll')
      .update(payload)
      .eq('id', id)
      .select(`
        *,
        users!payroll_employee_id_fkey (
          id,
          name,
          employee_profiles (
            employee_code,
            department
          )
        )
      `)
      .single();

    if (updateErr) {
      console.error('Error resetting draft payroll:', updateErr);
      throw { status: 500, code: 'DB_ERROR', message: updateErr.message };
    }

    return updated;
  }
}

export default PayrollService;
