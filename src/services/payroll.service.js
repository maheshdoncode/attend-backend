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

      // If it's a working day and not a paid holiday, increment workingDays count
      if (isWorkingDay && !holidayDates.has(dateStr)) {
        workingDays++;
      }
    }

    return workingDays > 0 ? workingDays : 26;
  }

  /**
   * Generates payroll for specified employees or all active employees for a given month and year.
   * Only run when owner requests payslip generation.
   */
  static async generatePayroll(month, year, employeeIds = []) {
    // 1. Fetch active deduction policies
    const { data: policies } = await supabase
      .from('deduction_policies')
      .select('*')
      .eq('is_active', true);

    const latePolicies = (policies || [])
      .filter((p) => p.condition_type === 'late_arrival')
      .sort((a, b) => (Number(b.threshold_minutes) || 0) - (Number(a.threshold_minutes) || 0));

    const earlyPolicies = (policies || [])
      .filter((p) => p.condition_type === 'early_departure')
      .sort((a, b) => (Number(b.threshold_minutes) || 0) - (Number(a.threshold_minutes) || 0));

    // 2. Fetch target employees
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

    const { data: employees, error: empError } = await userQuery;
    if (empError) {
      throw { status: 500, code: 'DB_ERROR', message: empError.message };
    }

    if (!employees || employees.length === 0) {
      return [];
    }

    const allEmpIds = employees.map((e) => e.id);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    // 3. Batch fetch existing payroll records
    const { data: existingPayrolls } = await supabase
      .from('payroll')
      .select('*')
      .in('employee_id', allEmpIds)
      .eq('month', month)
      .eq('year', year);

// 3. Existing payrolls fetched if needed

    // 4. Batch fetch all working day overrides for the month (working Sundays)
    let workingDaysOverrides = [];
    try {
      const { data: overrides } = await supabase
        .from('working_days_overrides')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate);
      workingDaysOverrides = overrides || [];
    } catch {
      workingDaysOverrides = [];
    }

    // 5. Batch fetch work schedules and employee schedule overrides
    const { data: allSchedules } = await supabase.from('work_schedules').select('*');
    const defaultSchedule =
      (allSchedules || []).find((s) => s.is_default) ||
      (allSchedules || [])[0] || {
        id: null,
        name: 'Standard Shift',
        start_time: '09:00:00',
        end_time: '18:00:00',
      };
    const scheduleMap = new Map((allSchedules || []).map((s) => [s.id, s]));

    const { data: scheduleOverrides } = await supabase
      .from('employee_schedule_overrides')
      .select('employee_id, schedule_id')
      .in('employee_id', allEmpIds);

    const empScheduleOverrideMap = new Map(
      (scheduleOverrides || []).map((o) => [o.employee_id, scheduleMap.get(o.schedule_id)])
    );

    // Fetch shift assignments with salaries
    const { data: shiftAssignments } = await supabase
      .from('employee_shift_assignments')
      .select('employee_id, schedule_id, salary')
      .in('employee_id', allEmpIds);

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

    // 6. Batch fetch holidays for the month
    const { data: monthHolidays } = await supabase
      .from('holidays')
      .select('date, name, branch_id')
      .gte('date', startDate)
      .lte('date', endDate);

    const allHolidays = monthHolidays || [];

    // 6b. Batch fetch approved advance salaries for all targeted employees
    let approvedAdvances = [];
    try {
      const { data: advances, error: advErr } = await supabase
        .from('advance_salaries')
        .select('*')
        .in('employee_id', allEmpIds)
        .or('status.eq.approved,status.eq.deducted');

      if (!advErr && advances) {
        approvedAdvances = advances.filter(
          (a) =>
            (!a.target_month && !a.target_year) || (Number(a.target_month) === Number(month) && Number(a.target_year) === Number(year))
        );
      }
    } catch (err) {
      console.warn('Warning: Could not fetch advance salaries:', err.message);
    }

    const empAdvancesMap = new Map();
    approvedAdvances.forEach((adv) => {
      if (!empAdvancesMap.has(adv.employee_id)) {
        empAdvancesMap.set(adv.employee_id, []);
      }
      empAdvancesMap.get(adv.employee_id).push(adv);
    });

    // 7. Batch fetch attendance records for all employees using pagination (to handle Supabase 1000 row max limit)
    let attendanceRecords = [];
    let attOffset = 0;
    const attPageSize = 1000;
    while (true) {
      const { data: pageData, error: attError } = await supabase
        .from('attendance')
        .select('*')
        .in('employee_id', allEmpIds)
        .gte('date', startDate)
        .lte('date', endDate)
        .range(attOffset, attOffset + attPageSize - 1);

      if (attError) {
        throw { status: 500, code: 'DB_ERROR', message: attError.message };
      }

      attendanceRecords = attendanceRecords.concat(pageData || []);
      if (!pageData || pageData.length < attPageSize) break;
      attOffset += attPageSize;
    }

    const empAttendanceMap = new Map();
    allEmpIds.forEach((id) => empAttendanceMap.set(id, new Map()));
    (attendanceRecords || []).forEach((r) => {
      if (empAttendanceMap.has(r.employee_id)) {
        const empMap = empAttendanceMap.get(r.employee_id);
        if (r.schedule_id) {
          empMap.set(`${r.date}_${r.schedule_id}`, r);
        }
        // Also map by date (or if first/single session on that date)
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
          if (!holidayDates.has(dateStr)) {
            workingDays++;
          }
        }
      }

      if (workingDays === 0) workingDays = 26;
      const perDaySalary = monthlySalary / workingDays;

      let presentDays = 0;
      let absentDays = 0;
      let lateCount = 0;
      let halfDayCount = 0;
      let totalDeductions = 0;
      const deductionBreakdown = [];

      for (const dateStr of employeeWorkingDates) {
        // Paid holiday: no deduction
        if (holidayDates.has(dateStr)) {
          continue;
        }

        for (const shiftItem of assignedShifts) {
          const shiftSchedule = shiftItem.schedule;
          const shiftSalary = shiftItem.salary;
          const shiftDailyRate = workingDays > 0 ? shiftSalary / workingDays : 0;
          const shiftMinutes = Math.max(
            1,
            parseTimeToMinutes(shiftSchedule.end_time) - parseTimeToMinutes(shiftSchedule.start_time)
          );

          // Find attendance for this shift on this date
          const record = attendanceMap.get(`${dateStr}_${shiftSchedule.id}`) || attendanceMap.get(dateStr);

          if (!record || record.status === 'absent') {
            absentDays++;
            const amount = Number(shiftDailyRate.toFixed(2));
            if (amount > 0) {
              totalDeductions += amount;
              deductionBreakdown.push({
                date: dateStr,
                type: 'absent',
                reason: assignedShifts.length > 1 ? `Absent (${shiftSchedule.name})` : 'Absent',
                policy_name: assignedShifts.length > 1 ? `Full Day Absent (${shiftSchedule.name})` : 'Full Day Absent',
                amount,
              });
            }
          } else if (record.status === 'half_day') {
            halfDayCount++;
            presentDays++;
            const amount = Number((shiftDailyRate / 2).toFixed(2));
            if (amount > 0) {
              totalDeductions += amount;
              deductionBreakdown.push({
                date: dateStr,
                type: 'half_day',
                reason: assignedShifts.length > 1 ? `Half Day (${shiftSchedule.name})` : 'Half Day',
                policy_name: assignedShifts.length > 1 ? `Half Day (${shiftSchedule.name})` : 'Half Day',
                amount,
              });
            }
          } else if (record.status === 'late') {
            lateCount++;
            presentDays++;
            let lateDeduction = 0;
            const lateMins = record.clock_in_time
              ? computeLateMinutes(record.clock_in_time, shiftSchedule.start_time)
              : 0;

            const applicableLatePolicies = latePolicies.filter(
              (p) => !p.schedule_id || (shiftSchedule.id && p.schedule_id === shiftSchedule.id)
            );
            const matchedLatePolicy = applicableLatePolicies.find(
              (p) => lateMins > (p.threshold_minutes ?? 10)
            ) || applicableLatePolicies[0];

            if (matchedLatePolicy && lateMins > (matchedLatePolicy.threshold_minutes ?? 10)) {
              if (matchedLatePolicy.deduction_type === 'fixed_minutes') {
                const deductionMins = matchedLatePolicy.deduction_minutes || 30;
                lateDeduction = (deductionMins / shiftMinutes) * shiftDailyRate;
              } else if (matchedLatePolicy.deduction_type === 'half_day') {
                lateDeduction = shiftDailyRate / 2;
              } else if (matchedLatePolicy.deduction_type === 'full_day') {
                lateDeduction = shiftDailyRate;
              }
            }

            if (lateDeduction > 0) {
              const amount = Number(lateDeduction.toFixed(2));
              totalDeductions += amount;
              deductionBreakdown.push({
                date: dateStr,
                type: 'late_arrival',
                reason: assignedShifts.length > 1 ? `${lateMins} min late (${shiftSchedule.name})` : `${lateMins} min late`,
                policy_name: matchedLatePolicy?.name || 'Late Arrival Policy',
                amount,
              });
            }
          } else if (record.status === 'present') {
            presentDays++;
          }
        }
      }

      // Process Advance Salary Deductions for this employee
      const empAdvances = empAdvancesMap.get(employeeId) || [];
      let advanceDeductionTotal = 0;
      empAdvances.forEach((adv) => {
        const advAmount = Number(adv.amount || 0);
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

      const grossSalary = Number(monthlySalary.toFixed(2));
      const totalDeductionsWithAdvance = Number((totalDeductions + advanceDeductionTotal).toFixed(2));
      const netSalary = Number((grossSalary - totalDeductionsWithAdvance).toFixed(2));

      payrollToUpsert.push({
        employee_id: employeeId,
        month,
        year,
        working_days: workingDays,
        present_days: presentDays,
        absent_days: absentDays,
        late_count: lateCount,
        half_day_count: halfDayCount,
        total_deduction_amount: totalDeductionsWithAdvance,
        advance_deduction: Number(advanceDeductionTotal.toFixed(2)),
        deduction_breakdown: deductionBreakdown,
        gross_salary: grossSalary,
        net_salary: netSalary,
        status: 'draft',
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
        for (const update of advanceUpdates) {
          try {
            await supabase
              .from('advance_salaries')
              .update({
                status: 'deducted',
                payroll_id: update.payroll_id,
                deducted_at: nowIso,
              })
              .eq('id', update.id);
          } catch (advUpdateErr) {
            console.warn('Warning: Failed to update advance salary status to deducted:', advUpdateErr.message);
          }
        }
      }
    }

    return payrollResults;
  }
}

export default PayrollService;
