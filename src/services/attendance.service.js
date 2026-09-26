import { supabase } from '../db/supabase.js';
import { isWithinRadius } from '../utils/geo.js';
import { validateQRPayload } from '../utils/qr.js';
import {
  getEmployeeSchedule,
  getEmployeeActiveShift,
  parseTimeToMinutes,
  getMinutesFromMidnight,
  isHoliday,
  computeLateMinutes,
  computeEarlyMinutes,
  isHalfDay,
} from '../utils/schedule.js';

export class AttendanceService {
  /**
   * Process employee clock-in
   */
  static async clockIn(employeeId, { qr_payload, latitude, longitude, schedule_id }) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // 1. Parse QR payload and extract branch_id
    let parsedPayload;
    try {
      parsedPayload = typeof qr_payload === 'object' ? qr_payload : JSON.parse(qr_payload);
    } catch (e) {
      throw { status: 400, code: 'INVALID_QR', message: 'Invalid or malformed QR code payload' };
    }

    const branchId = parsedPayload?.branch_id;
    if (!branchId) {
      throw { status: 400, code: 'INVALID_QR', message: 'QR code does not contain branch information' };
    }

    // 2. Fetch branch
    const { data: branch, error: branchError } = await supabase
      .from('branches')
      .select('*')
      .eq('id', branchId)
      .eq('is_active', true)
      .maybeSingle();

    if (branchError || !branch) {
      throw { status: 404, code: 'BRANCH_NOT_FOUND', message: 'Branch not found or inactive' };
    }

    // 3. Validate QR
    const qrValidation = validateQRPayload(parsedPayload, branch);
    if (!qrValidation.valid) {
      throw { status: 400, code: 'INVALID_QR', message: 'Invalid or expired QR code' };
    }

    // 4. Check Geofencing radius
    const inRadius = isWithinRadius(
      latitude,
      longitude,
      branch.latitude,
      branch.longitude,
      branch.radius_meters || 100
    );

    if (!inRadius) {
      throw { status: 400, code: 'OUT_OF_RADIUS', message: 'You are outside the allowed location radius' };
    }

    // 5. Check if today is a holiday
    const holidayToday = await isHoliday(today, branchId);
    if (holidayToday) {
      throw { status: 400, code: 'HOLIDAY', message: 'Today is a holiday' };
    }

    // 6. Check today's existing attendance sessions
    const { data: todayAttendance } = await supabase
      .from('attendance')
      .select('id, schedule_id, clock_in_time, clock_out_time')
      .eq('employee_id', employeeId)
      .eq('date', today);

    // 7. Get active shift for current punch time
    let schedule = null;
    if (schedule_id) {
      const { data: directSched } = await supabase
        .from('work_schedules')
        .select('*')
        .eq('id', schedule_id)
        .maybeSingle();
      if (directSched) schedule = directSched;
    }
    if (!schedule) {
      schedule = await getEmployeeActiveShift(employeeId, now, todayAttendance || []);
    }
    const scheduleId = schedule?.id || null;

    // Check early clock-in limit (e.g. 30 mins before shift start)
    if (schedule && schedule.start_time) {
      const earlyLimit = Number(schedule.early_clock_in_limit_minutes) || 30;
      const startMins = parseTimeToMinutes(schedule.start_time);
      const currentMins = getMinutesFromMidnight(now);
      const earliestAllowedMins = startMins - earlyLimit;

      if (currentMins < earliestAllowedMins && earliestAllowedMins >= 0) {
        const earliestHour = Math.floor(earliestAllowedMins / 60);
        const earliestMinute = earliestAllowedMins % 60;
        const earliestTimeStr = String(earliestHour).padStart(2, '0') + ':' + String(earliestMinute).padStart(2, '0');
        throw {
          status: 400,
          code: 'EARLY_CLOCK_IN_BLOCKED',
          message: 'Clock-in is not allowed before ' + earliestTimeStr + ' for ' + (schedule.name || 'this shift') + '.',
        };
      }
    }

    // If an active session is currently in progress
    let autoClosedWarning = null;
    const openSession = (todayAttendance || []).find((a) => a.clock_in_time && !a.clock_out_time);
    if (openSession) {
      // If open session is for the SAME shift, throw error
      if (openSession.schedule_id === scheduleId) {
        throw { status: 409, code: 'ALREADY_CLOCKED_IN', message: 'You are already clocked into ' + (schedule.name || 'this shift') + '.' };
      }

      // If open session is for a DIFFERENT (earlier) shift, auto-close it at its scheduled end time
      const { data: prevSchedule } = openSession.schedule_id
        ? await supabase.from('work_schedules').select('*').eq('id', openSession.schedule_id).maybeSingle()
        : { data: null };

      const prevEndTime = prevSchedule?.end_time || '18:00:00';
      const prevEndIso = today + 'T' + (prevEndTime.length === 5 ? prevEndTime + ':00' : prevEndTime) + '.000Z';

      await supabase
        .from('attendance')
        .update({
          clock_out_time: prevEndIso,
          status: 'present',
          admin_notes: 'Auto-closed at scheduled shift end time (' + prevEndTime + ') upon clock-in to ' + (schedule.name || 'next shift'),
        })
        .eq('id', openSession.id);

      const prevName = prevSchedule?.name || 'earlier shift';
      autoClosedWarning = 'You forgot to clock out for ' + prevName + '. It was automatically recorded at ' + prevEndTime.slice(0, 5) + '.';
    }

    // Check if already completed this specific shift today
    const alreadyCompletedThisShift = (todayAttendance || []).find(
      (a) => a.schedule_id === scheduleId && a.clock_out_time != null
    );
    if (alreadyCompletedThisShift) {
      throw { status: 409, code: 'SHIFT_COMPLETED', message: `You have already completed the ${schedule.name || 'shift'} today` };
    }

    const existingAttendanceForShift = (todayAttendance || []).find(
      (a) => a.schedule_id === scheduleId
    );

    // 8. Determine attendance status
    const lateMinutes = computeLateMinutes(now, schedule.start_time);

    // Fetch active late arrival policies (shift specific + global)
    const { data: latePolicies } = await supabase
      .from('deduction_policies')
      .select('*')
      .eq('condition_type', 'late_arrival')
      .eq('is_active', true);

    const applicableLatePolicies = (latePolicies || [])
      .filter((p) => !p.schedule_id || (schedule.id && p.schedule_id === schedule.id))
      .sort((a, b) => (Number(b.threshold_minutes) || 0) - (Number(a.threshold_minutes) || 0));

    const matchedLatePolicy = applicableLatePolicies.find(
      (p) => lateMinutes > (Number(p.threshold_minutes) || 0)
    ) || null;

    let status = 'present';
    let isFlagged = false;
    let flagReason = null;

    if (matchedLatePolicy && lateMinutes > (Number(matchedLatePolicy.threshold_minutes) || 0)) {
      status = matchedLatePolicy.deduction_type === 'half_day' ? 'half_day' : 'late';
      flagReason = matchedLatePolicy.name
        ? `Late arrival (${lateMinutes} min late • ${matchedLatePolicy.name})`
        : `Late arrival (${lateMinutes} min late)`;
      isFlagged = true;
    } else if (isHalfDay(now, schedule)) {
      status = 'half_day';
      flagReason = 'Half Day';
    }

    // 9. Insert or update attendance record
    const attendancePayload = {
      employee_id: employeeId,
      branch_id: branchId,
      schedule_id: scheduleId,
      date: today,
      clock_in_time: now.toISOString(),
      clock_in_lat: Number(latitude),
      clock_in_lng: Number(longitude),
      status,
      is_flagged: isFlagged,
      flag_reason: flagReason,
    };

    let resultRecord;
    if (existingAttendanceForShift) {
      const { data, error } = await supabase
        .from('attendance')
        .update(attendancePayload)
        .eq('id', existingAttendanceForShift.id)
        .select()
        .single();
      if (error) throw { status: 500, code: 'DB_ERROR', message: error.message };
      resultRecord = data;
    } else {
      const { data, error } = await supabase
        .from('attendance')
        .insert(attendancePayload)
        .select()
        .single();
      if (error) throw { status: 500, code: 'DB_ERROR', message: error.message };
      resultRecord = data;
    }

    return {
      success: true,
      attendance_id: resultRecord.id,
      status: resultRecord.status,
      clock_in_time: resultRecord.clock_in_time,
      late_minutes: lateMinutes,
    };
  }

  /**
   * Process employee clock-out
   */
  static async clockOut(employeeId, { qr_payload, latitude, longitude }) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // 1. Parse QR payload
    let parsedPayload;
    try {
      parsedPayload = typeof qr_payload === 'object' ? qr_payload : JSON.parse(qr_payload);
    } catch (e) {
      throw { status: 400, code: 'INVALID_QR', message: 'Invalid or malformed QR code payload' };
    }

    const branchId = parsedPayload?.branch_id;
    if (!branchId) {
      throw { status: 400, code: 'INVALID_QR', message: 'QR code does not contain branch information' };
    }

    // 2. Fetch branch
    const { data: branch, error: branchError } = await supabase
      .from('branches')
      .select('*')
      .eq('id', branchId)
      .eq('is_active', true)
      .maybeSingle();

    if (branchError || !branch) {
      throw { status: 404, code: 'BRANCH_NOT_FOUND', message: 'Branch not found or inactive' };
    }

    // 3. Validate QR
    const qrValidation = validateQRPayload(parsedPayload, branch);
    if (!qrValidation.valid) {
      throw { status: 400, code: 'INVALID_QR', message: 'Invalid or expired QR code' };
    }

    // 4. Geofence radius check
    const inRadius = isWithinRadius(
      latitude,
      longitude,
      branch.latitude,
      branch.longitude,
      branch.radius_meters || 100
    );

    if (!inRadius) {
      throw { status: 400, code: 'OUT_OF_RADIUS', message: 'You are outside the allowed location radius' };
    }

    // 5. Find today's active attendance row
    const { data: attendance, error: attError } = await supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('date', today)
      .is('clock_out_time', null)
      .maybeSingle();

    if (attError || !attendance || !attendance.clock_in_time) {
      throw { status: 400, code: 'NO_ACTIVE_CLOCK_IN', message: 'No active clock-in found for today' };
    }

    // 6. Update record with clock-out time while preserving existing flags (e.g. Late Arrival) and detecting early departure
    const clockInDate = new Date(attendance.clock_in_time);
    const hoursWorked = Math.max(
      0,
      Number(((now.getTime() - clockInDate.getTime()) / (1000 * 60 * 60)).toFixed(2))
    );

    let isFlagged = Boolean(attendance.is_flagged);
    let flagReason = attendance.flag_reason || null;

    let finalStatus = attendance.status || 'present';

    // Check early departure & half-day if shift schedule is present
    if (attendance.schedule_id) {
      try {
        const { data: schedule } = await supabase
          .from('work_schedules')
          .select('*')
          .eq('id', attendance.schedule_id)
          .maybeSingle();

        if (schedule && schedule.start_time && schedule.end_time) {
          const shiftStartMins = parseTimeToMinutes(schedule.start_time);
          let shiftEndMins = parseTimeToMinutes(schedule.end_time);
          if (shiftEndMins <= shiftStartMins) shiftEndMins += 24 * 60;
          const totalShiftMins = Math.max(60, shiftEndMins - shiftStartMins);
          const workedMins = Math.floor((now.getTime() - clockInDate.getTime()) / 60000);

          if (workedMins < totalShiftMins / 2) {
            finalStatus = 'half_day';
            const halfDayReason = `Half Day (${Math.floor(workedMins / 60)}h ${workedMins % 60}m worked of ${Math.floor(totalShiftMins / 60)}h shift)`;
            isFlagged = true;
            flagReason = flagReason ? `${flagReason}, ${halfDayReason}` : halfDayReason;
          } else {
            const currentMins = now.getHours() * 60 + now.getMinutes();
            if (currentMins < shiftEndMins - 15) {
              const earlyMins = shiftEndMins - currentMins;
              const earlyReason = `${earlyMins} min early departure`;
              isFlagged = true;
              flagReason = flagReason ? `${flagReason}, ${earlyReason}` : earlyReason;
            }
          }
        }
      } catch (e) {
        console.warn('Error checking early departure / half day:', e.message);
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('attendance')
      .update({
        clock_out_time: now.toISOString(),
        clock_out_lat: Number(latitude),
        clock_out_lng: Number(longitude),
        status: finalStatus,
        is_flagged: isFlagged,
        flag_reason: flagReason,
      })
      .eq('id', attendance.id)
      .select()
      .single();

    if (updateError) {
      throw { status: 500, code: 'DB_ERROR', message: updateError.message };
    }

    return {
      success: true,
      clock_out_time: updated.clock_out_time,
      hours_worked: hoursWorked,
    };
  }

  /**
   * Internal cron job for daily auto-flagging missing clock-outs and marking absent employees.
   */
  static async autoFlagDaily() {
    const today = new Date().toISOString().split('T')[0];

    // 1. Flag records with clock_in but missing clock_out
    const { data: unclosedRecords, error: unclosedErr } = await supabase
      .from('attendance')
      .select('id')
      .eq('date', today)
      .not('clock_in_time', 'is', null)
      .is('clock_out_time', null);

    let flaggedCount = 0;
    if (unclosedRecords && unclosedRecords.length > 0) {
      const ids = unclosedRecords.map((r) => r.id);
      const { error: flagErr } = await supabase
        .from('attendance')
        .update({
          is_flagged: true,
          flag_reason: 'Missing clock-out',
        })
        .in('id', ids);

      if (!flagErr) flaggedCount = ids.length;
    }

    // 2. Mark active employees with no attendance as absent (unless regular weekend or holiday)
    const todayDate = new Date();
    const isSunday = todayDate.getDay() === 0;

    // Fetch working day overrides for today
    let workingDaysOverrides = [];
    try {
      const { data: overrides } = await supabase
        .from('working_days_overrides')
        .select('*')
        .eq('date', today);
      workingDaysOverrides = overrides || [];
    } catch {
      workingDaysOverrides = [];
    }

    // Fetch all active employees
    const { data: employees } = await supabase
      .from('users')
      .select('id, branch_employee_assignments(branch_id), branch_managers(branch_id)')
      .in('role', ['employee', 'branch_manager'])
      .eq('is_active', true);

    let absentCount = 0;
    if (employees && employees.length > 0) {
      for (const emp of employees) {
        const branchId = emp.branch_employee_assignments?.[0]?.branch_id || emp.branch_managers?.[0]?.branch_id || null;

        // Determine if today is an official working day for this employee
        let isWorkingDay = !isSunday; // Mon-Sat default

        if (isSunday) {
          const isSpecialWorkingSunday = workingDaysOverrides.some((o) => {
            if (o.date !== today) return false;
            if (o.employee_id && o.employee_id === emp.id) return true;
            if (!o.employee_id && (!o.branch_id || o.branch_id === branchId)) return true;
            return false;
          });
          if (isSpecialWorkingSunday) {
            isWorkingDay = true;
          }
        }

        if (!isWorkingDay) continue; // Regular Sunday off

        const holiday = await isHoliday(today, branchId);

        if (!holiday) {
          const { data: att } = await supabase
            .from('attendance')
            .select('id')
            .eq('employee_id', emp.id)
            .eq('date', today)
            .maybeSingle();

          if (!att) {
            await supabase.from('attendance').insert({
              employee_id: emp.id,
              branch_id: branchId,
              date: today,
              status: 'absent',
              is_flagged: false,
            });
            absentCount++;
          }
        }
      }
    }

    return {
      success: true,
      date: today,
      flagged_missing_clockout: flaggedCount,
      marked_absent: absentCount,
    };
  }

  /**
   * Manual Attendance Punch by Owner or Branch Manager
   */
  static async manualPunch({ employee_id, action, branch_id, time, admin_notes, schedule_id }) {
    if (!employee_id) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'employee_id is required' };
    }
    if (!['clock_in', 'clock_out'].includes(action)) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'action must be clock_in or clock_out' };
    }

    const now = time ? new Date(time) : new Date();
    let today;
    try {
      today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    } catch (e) {
      today = now.toISOString().split('T')[0];
    }

    let effectiveBranchId = branch_id;
    if (!effectiveBranchId) {
      const { data: assignment } = await supabase
        .from('branch_employee_assignments')
        .select('branch_id')
        .eq('employee_id', employee_id)
        .limit(1)
        .maybeSingle();
      effectiveBranchId = assignment?.branch_id || null;
    }

    let attQuery = supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', employee_id)
      .eq('date', today);
    if (schedule_id) {
      attQuery = attQuery.eq('schedule_id', schedule_id);
    }
    const { data: existingRecords } = await attQuery;
    const existingAttendance = existingRecords && existingRecords.length > 0 ? existingRecords[0] : null;

    if (action === 'clock_in') {
      if (existingAttendance && existingAttendance.clock_in_time) {
        throw { status: 409, code: 'ALREADY_CLOCKED_IN', message: 'Employee is already clocked in today' };
      }

      let schedule = null;
      if (schedule_id) {
        const { data: sch } = await supabase.from('work_schedules').select('*').eq('id', schedule_id).maybeSingle();
        if (sch) schedule = sch;
      }
      if (!schedule) {
        schedule = await getEmployeeSchedule(employee_id);
      }
      const lateMinutes = computeLateMinutes(now, schedule.start_time);
      const { data: latePolicies } = await supabase
        .from('deduction_policies')
        .select('*')
        .eq('condition_type', 'late_arrival')
        .eq('is_active', true);

      const applicableLatePolicies = (latePolicies || [])
        .filter((p) => !p.schedule_id || (schedule.id && p.schedule_id === schedule.id))
        .sort((a, b) => (Number(b.threshold_minutes) || 0) - (Number(a.threshold_minutes) || 0));

      const matchedLatePolicy = applicableLatePolicies.find(
        (p) => lateMinutes > (Number(p.threshold_minutes) || 0)
      ) || null;

      let status = 'present';
      let isFlagged = false;
      let flagReason = null;

      if (matchedLatePolicy && lateMinutes > (Number(matchedLatePolicy.threshold_minutes) || 0)) {
        status = matchedLatePolicy.deduction_type === 'half_day' ? 'half_day' : 'late';
        flagReason = matchedLatePolicy.name
          ? `Late arrival (${lateMinutes} min late • ${matchedLatePolicy.name})`
          : `Late arrival (${lateMinutes} min late)`;
        isFlagged = true;
      } else if (isHalfDay(now, schedule)) {
        status = 'half_day';
        flagReason = 'Half Day';
      }

      const payload = {
        employee_id,
        branch_id: effectiveBranchId,
        schedule_id: schedule_id || schedule.id || null,
        date: today,
        clock_in_time: now.toISOString(),
        clock_in_lat: null,
        clock_in_lng: null,
        status,
        is_flagged: isFlagged,
        flag_reason: flagReason,
        admin_notes: admin_notes || 'Manual Clock-In by Admin/Manager',
      };

      if (existingAttendance) {
        const { data, error } = await supabase
          .from('attendance')
          .update(payload)
          .eq('id', existingAttendance.id)
          .select('*, branch:branches(*)')
          .single();
        if (error) throw { status: 500, code: 'DB_ERROR', message: error.message };
        return { success: true, message: 'Clocked in manually', record: data };
      } else {
        const { data, error } = await supabase
          .from('attendance')
          .insert(payload)
          .select('*, branch:branches(*)')
          .single();
        if (error) throw { status: 500, code: 'DB_ERROR', message: error.message };
        return { success: true, message: 'Clocked in manually', record: data };
      }
    } else {
      if (!existingAttendance || !existingAttendance.clock_in_time) {
        throw { status: 400, code: 'NOT_CLOCKED_IN', message: 'Employee has not clocked in today' };
      }
      if (existingAttendance.clock_out_time) {
        throw { status: 409, code: 'ALREADY_CLOCKED_OUT', message: 'Employee is already clocked out today' };
      }

      let schedule = null;
      if (existingAttendance.schedule_id) {
        const { data: sch } = await supabase.from('work_schedules').select('*').eq('id', existingAttendance.schedule_id).maybeSingle();
        if (sch) schedule = sch;
      }
      if (!schedule) {
        schedule = await getEmployeeSchedule(employee_id);
      }

      const clockInTime = new Date(existingAttendance.clock_in_time);
      if (now < clockInTime) {
        throw { status: 400, code: 'INVALID_TIME', message: 'Clock-out time must be at or after clock-in time' };
      }

      // 1. Evaluate Late Arrival
      const lateMinutes = computeLateMinutes(clockInTime, schedule.start_time);
      const { data: latePolicies } = await supabase
        .from('deduction_policies')
        .select('*')
        .eq('condition_type', 'late_arrival')
        .eq('is_active', true);

      const applicableLatePolicies = (latePolicies || [])
        .filter((p) => !p.schedule_id || (schedule.id && p.schedule_id === schedule.id))
        .sort((a, b) => (Number(b.threshold_minutes) || 0) - (Number(a.threshold_minutes) || 0));

      const matchedLatePolicy = applicableLatePolicies.find(
        (p) => lateMinutes > (Number(p.threshold_minutes) || 0)
      ) || null;

      let lateFlag = null;
      let lateStatus = 'present';
      if (matchedLatePolicy && lateMinutes > (Number(matchedLatePolicy.threshold_minutes) || 0)) {
        lateStatus = matchedLatePolicy.deduction_type === 'half_day' ? 'half_day' : 'late';
        lateFlag = matchedLatePolicy.name
          ? `Late arrival (${lateMinutes} min late • ${matchedLatePolicy.name})`
          : `Late arrival (${lateMinutes} min late)`;
      }

      // 2. Evaluate Early Departure & Half Day
      const earlyMinutes = computeEarlyMinutes(now, schedule.end_time);
      const { data: earlyPolicies } = await supabase
        .from('deduction_policies')
        .select('*')
        .eq('condition_type', 'early_departure')
        .eq('is_active', true);

      const applicableEarlyPolicies = (earlyPolicies || [])
        .filter((p) => !p.schedule_id || (schedule.id && p.schedule_id === schedule.id))
        .sort((a, b) => (Number(b.threshold_minutes) || 0) - (Number(a.threshold_minutes) || 0));

      const matchedEarlyPolicy = applicableEarlyPolicies.find(
        (p) => earlyMinutes > (Number(p.threshold_minutes) || 0)
      ) || null;

      let earlyFlag = null;
      let isHalfDayEarly = false;
      if (matchedEarlyPolicy && earlyMinutes > (Number(matchedEarlyPolicy.threshold_minutes) || 0)) {
        if (matchedEarlyPolicy.deduction_type === 'half_day') {
          isHalfDayEarly = true;
        }
        earlyFlag = matchedEarlyPolicy.name
          ? `Early departure (${earlyMinutes} min early • ${matchedEarlyPolicy.name})`
          : `Early departure (${earlyMinutes} min early)`;
      }

      // Check if total worked time is less than half shift
      const shiftStartMins = parseTimeToMinutes(schedule.start_time);
      let shiftEndMins = parseTimeToMinutes(schedule.end_time);
      if (shiftEndMins <= shiftStartMins) shiftEndMins += 24 * 60;
      const totalShiftMins = Math.max(60, shiftEndMins - shiftStartMins);
      const workedMins = Math.floor((now.getTime() - clockInTime.getTime()) / 60000);
      if (workedMins < totalShiftMins / 2) {
        isHalfDayEarly = true;
        if (!earlyFlag) {
          earlyFlag = `Half Day (${Math.floor(workedMins / 60)}h ${workedMins % 60}m worked of ${Math.floor(totalShiftMins / 60)}h shift)`;
        }
      }

      // 3. Combined Status & Combined Flags
      let finalStatus = 'present';
      if (isHalfDayEarly || lateStatus === 'half_day') {
        finalStatus = 'half_day';
      } else if (lateStatus === 'late') {
        finalStatus = 'late';
      }

      const flags = [];
      if (lateFlag) flags.push(lateFlag);
      if (earlyFlag) flags.push(earlyFlag);

      const isFlagged = flags.length > 0;
      const flagReason = flags.length > 0 ? flags.join(' • ') : null;

      const { data, error } = await supabase
        .from('attendance')
        .update({
          clock_out_time: now.toISOString(),
          clock_out_lat: null,
          clock_out_lng: null,
          status: finalStatus,
          is_flagged: isFlagged,
          flag_reason: flagReason,
          admin_notes: admin_notes || existingAttendance.admin_notes || 'Manual Clock-Out by Admin/Manager',
        })
        .eq('id', existingAttendance.id)
        .select('*, branch:branches(*)')
        .single();

      if (error) throw { status: 500, code: 'DB_ERROR', message: error.message };
      return { success: true, message: 'Clocked out manually', record: data };
    }
  }

  /**
   * Process employee lunch start (break start)
   */
  static async startLunch(employeeId, { latitude, longitude }) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // 1. Find today's active attendance session
    const { data: attendance, error } = await supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('date', today)
      .is('clock_out_time', null)
      .maybeSingle();

    if (error || !attendance || !attendance.clock_in_time) {
      throw {
        status: 400,
        code: 'NO_ACTIVE_CLOCK_IN',
        message: 'You must be clocked into a shift to start lunch break',
      };
    }

    if (attendance.lunch_start_time && !attendance.lunch_end_time) {
      throw {
        status: 409,
        code: 'ALREADY_ON_LUNCH',
        message: 'You are already on lunch break',
      };
    }

    if (attendance.lunch_start_time && attendance.lunch_end_time) {
      throw {
        status: 409,
        code: 'LUNCH_ALREADY_COMPLETED',
        message: 'You have already completed your lunch break for this shift',
      };
    }

    // 2. Update attendance record with lunch_start_time
    const { data: updated, error: updateErr } = await supabase
      .from('attendance')
      .update({
        lunch_start_time: now.toISOString(),
        lunch_start_lat: latitude !== undefined ? Number(latitude) : null,
        lunch_start_lng: longitude !== undefined ? Number(longitude) : null,
      })
      .eq('id', attendance.id)
      .select()
      .single();

    if (updateErr) {
      throw { status: 500, code: 'DB_ERROR', message: updateErr.message };
    }

    return {
      success: true,
      attendance_id: updated.id,
      lunch_start_time: updated.lunch_start_time,
      status: 'on_lunch',
      message: 'Lunch break started',
    };
  }

  /**
   * Process employee lunch end (return to work)
   */
  static async endLunch(employeeId, { latitude, longitude }) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // 1. Find today's active attendance session where lunch_start_time is set but lunch_end_time is null
    const { data: attendance, error } = await supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('date', today)
      .is('clock_out_time', null)
      .not('lunch_start_time', 'is', null)
      .is('lunch_end_time', null)
      .maybeSingle();

    if (error || !attendance) {
      throw {
        status: 400,
        code: 'NOT_ON_LUNCH',
        message: 'No active lunch break found to end',
      };
    }

    const startTime = new Date(attendance.lunch_start_time);
    const durationMinutes = Math.max(
      0,
      Math.round((now.getTime() - startTime.getTime()) / (1000 * 60))
    );

    // 2. Update attendance record with lunch_end_time and duration
    const { data: updated, error: updateErr } = await supabase
      .from('attendance')
      .update({
        lunch_end_time: now.toISOString(),
        lunch_end_lat: latitude !== undefined ? Number(latitude) : null,
        lunch_end_lng: longitude !== undefined ? Number(longitude) : null,
        lunch_duration_minutes: durationMinutes,
      })
      .eq('id', attendance.id)
      .select()
      .single();

    if (updateErr) {
      throw { status: 500, code: 'DB_ERROR', message: updateErr.message };
    }

    return {
      success: true,
      attendance_id: updated.id,
      lunch_start_time: updated.lunch_start_time,
      lunch_end_time: updated.lunch_end_time,
      lunch_duration_minutes: durationMinutes,
      status: 'present',
      message: 'Lunch break ended. Welcome back to work!',
    };
  }
}

export default AttendanceService;
