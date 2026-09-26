import { supabase } from '../db/supabase.js';
import { AttendanceService } from '../services/attendance.service.js';
import { parseTimeToMinutes, computeLateMinutes } from '../utils/schedule.js';

export const resolveEmployeeAttendanceStatus = (att, schedule, targetDate) => {
  let explicitStatus = typeof att === 'string' ? att : att?.status;

  // Check if worked duration is less than half the shift -> automatically half_day
  if (att && typeof att === 'object' && att.clock_in_time && att.clock_out_time && schedule?.start_time && schedule?.end_time) {
    const inDate = new Date(att.clock_in_time);
    const outDate = new Date(att.clock_out_time);
    const workedMins = Math.floor((outDate.getTime() - inDate.getTime()) / 60000);
    const startMins = parseTimeToMinutes(schedule.start_time);
    let endMins = parseTimeToMinutes(schedule.end_time);
    if (endMins <= startMins) endMins += 24 * 60;
    const totalShiftMins = Math.max(60, endMins - startMins);
    if (workedMins < totalShiftMins / 2) {
      return 'half_day';
    }
  }

  if (explicitStatus && explicitStatus !== 'not_marked') {
    return explicitStatus;
  }

  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = String(now.getMonth() + 1).padStart(2, '0');
  const todayDay = String(now.getDate()).padStart(2, '0');
  const todayStr = todayYear + '-' + todayMonth + '-' + todayDay;

  if (targetDate < todayStr) {
    return 'absent';
  } else if (targetDate === todayStr) {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const endMinutes = parseTimeToMinutes(schedule?.end_time || '18:00:00');
    if (currentMinutes >= endMinutes) {
      return 'absent';
    } else {
      return 'not_marked';
    }
  } else {
    return 'not_marked';
  }
};

export class AttendanceController {
  /**
   * POST /api/hrm/attendance/clock-in
   * Accessible by: employee
   */
  static async clockIn(req, res) {
    try {
      const { qr_payload, latitude, longitude, schedule_id } = req.body;

      if (!qr_payload || latitude === undefined || longitude === undefined) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'qr_payload, latitude, and longitude are required',
          },
        });
      }

      const result = await AttendanceService.clockIn(req.user.id, {
        qr_payload,
        latitude,
        longitude,
        schedule_id,
      });

      return res.status(200).json(result);
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: {
          code: err.code || 'CLOCK_IN_FAILED',
          message: err.message || 'Failed to clock in',
        },
      });
    }
  }

  /**
   * POST /api/hrm/attendance/clock-out
   * Accessible by: employee
   */
  static async clockOut(req, res) {
    try {
      const { qr_payload, latitude, longitude } = req.body;

      if (!qr_payload || latitude === undefined || longitude === undefined) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'qr_payload, latitude, and longitude are required',
          },
        });
      }

      const result = await AttendanceService.clockOut(req.user.id, {
        qr_payload,
        latitude,
        longitude,
      });

      return res.status(200).json(result);
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: {
          code: err.code || 'CLOCK_OUT_FAILED',
          message: err.message || 'Failed to clock out',
        },
      });
    }
  }

  /**
   * POST /api/hrm/attendance/lunch-start
   * Accessible by: employee, branch_manager
   */
  static async startLunch(req, res) {
    try {
      const { latitude, longitude } = req.body || {};
      const result = await AttendanceService.startLunch(req.user.id, {
        latitude,
        longitude,
      });
      return res.status(200).json(result);
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: {
          code: err.code || 'START_LUNCH_FAILED',
          message: err.message || 'Failed to start lunch break',
        },
      });
    }
  }

  /**
   * POST /api/hrm/attendance/lunch-end
   * Accessible by: employee, branch_manager
   */
  static async endLunch(req, res) {
    try {
      const { latitude, longitude } = req.body || {};
      const result = await AttendanceService.endLunch(req.user.id, {
        latitude,
        longitude,
      });
      return res.status(200).json(result);
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: {
          code: err.code || 'END_LUNCH_FAILED',
          message: err.message || 'Failed to end lunch break',
        },
      });
    }
  }

  /**
   * GET /api/hrm/attendance
   * Accessible by: owner, branch_manager
   * Query: ?branch_id=&employee_id=&date=&month=&year=&status=&flagged=&page=1&limit=20
   */
  static async list(req, res) {
    try {
      const {
        branch_id,
        employee_id,
        date,
        month,
        year,
        status,
        flagged,
        page = 1,
        limit = 20,
      } = req.query;

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const offset = (pageNum - 1) * limitNum;

      let query = supabase
        .from('attendance')
        .select(
          `
          id,
          employee_id,
          branch_id,
          date,
          clock_in_time,
          clock_in_lat,
          clock_in_lng,
          clock_out_time,
          clock_out_lat,
          clock_out_lng,
          status,
          is_flagged,
          flag_reason,
          admin_notes,
          created_at,
          users!attendance_employee_id_fkey (
            name,
            email,
            employee_profiles (
              employee_code,
              department
            )
          ),
          branches (
            name
          )
        `,
          { count: 'exact' }
        );

      // Branch Manager scoping
      if (req.user.role === 'branch_manager') {
        const scopedIds = req.scopedBranchIds || [];
        if (scopedIds.length === 0) {
          return res.status(200).json({
            success: true,
            total: 0,
            page: pageNum,
            limit: limitNum,
            records: [],
          });
        }
        if (branch_id) {
          if (!scopedIds.includes(branch_id)) {
            return res.status(403).json({
              success: false,
              error: { code: 'FORBIDDEN', message: 'Access denied for this branch' },
            });
          }
          query = query.eq('branch_id', branch_id);
        } else {
          query = query.in('branch_id', scopedIds);
        }
      } else if (branch_id) {
        query = query.eq('branch_id', branch_id);
      }

      if (employee_id) query = query.eq('employee_id', employee_id);
      if (date) query = query.eq('date', date);
      if (status) query = query.eq('status', status);
      if (flagged !== undefined) query = query.eq('is_flagged', flagged === 'true');

      if (month && year) {
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        query = query.gte('date', startDate).lte('date', endDate);
      } else if (year) {
        query = query.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
      }

      const { data, count, error } = await query
        .order('date', { ascending: false })
        .order('clock_in_time', { ascending: false, nullsFirst: false })
        .range(offset, offset + limitNum - 1);

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      const formatted = (data || []).map((r) => {
        const user = r.users;
        const profile = Array.isArray(user?.employee_profiles)
          ? user.employee_profiles[0]
          : user?.employee_profiles;

        return {
          id: r.id,
          employee_id: r.employee_id,
          employee_name: user?.name || null,
          employee_code: profile?.employee_code || null,
          department: profile?.department || null,
          branch_id: r.branch_id,
          branch_name: r.branches?.name || null,
          date: r.date,
          clock_in_time: r.clock_in_time,
          clock_in_lat: r.clock_in_lat,
          clock_in_lng: r.clock_in_lng,
          clock_out_time: r.clock_out_time,
          clock_out_lat: r.clock_out_lat,
          clock_out_lng: r.clock_out_lng,
          lunch_start_time: r.lunch_start_time || null,
          lunch_end_time: r.lunch_end_time || null,
          lunch_duration_minutes: r.lunch_duration_minutes || null,
          is_on_lunch: Boolean(r.lunch_start_time && !r.lunch_end_time),
          status: r.status,
          is_flagged: r.is_flagged,
          flag_reason: r.flag_reason,
          admin_notes: r.admin_notes,
          created_at: r.created_at,
        };
      });

      return res.status(200).json({
        success: true,
        total: count || formatted.length,
        page: pageNum,
        limit: limitNum,
        records: formatted,
      });
    } catch (err) {
      console.error('List attendance error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/attendance/my
   * Accessible by: employee
   * Query: ?month=&year=
   */
  static async myAttendance(req, res) {
    try {
      const employeeId = req.user.id;
      const { month, year } = req.query;

      let query = supabase
        .from('attendance')
        .select(`
          id,
          date,
          clock_in_time,
          clock_out_time,
          lunch_start_time,
          lunch_end_time,
          lunch_duration_minutes,
          status,
          is_flagged,
          flag_reason,
          schedule_id,
          branches (name),
          work_schedules (id, name, start_time, end_time, has_break, break_start_time, break_end_time)
        `)
        .eq('employee_id', employeeId);

      if (month && year) {
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        query = query.gte('date', startDate).lte('date', endDate);
      } else if (year) {
        query = query.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
      }

      const { data, error } = await query.order('date', { ascending: false });

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      let totalPresent = 0;
      let totalLate = 0;
      let totalHalfDay = 0;
      let totalAbsent = 0;

      const formatted = (data || []).map((r) => {
        const s = (r.status || '').toLowerCase();
        if (s === 'present') {
          totalPresent++;
        } else if (s === 'late') {
          totalLate++;
          totalPresent++; // Arrived late but present at work
        } else if (s === 'half_day') {
          totalHalfDay++;
          totalPresent++; // Present for half shift
        } else if (s === 'absent') {
          totalAbsent++;
        }

        return {
          id: r.id,
          date: r.date,
          branch_name: r.branches?.name || null,
          clock_in_time: r.clock_in_time,
          clock_out_time: r.clock_out_time,
          lunch_start_time: r.lunch_start_time || null,
          lunch_end_time: r.lunch_end_time || null,
          lunch_duration_minutes: r.lunch_duration_minutes || null,
          is_on_lunch: Boolean(r.lunch_start_time && !r.lunch_end_time),
          status: r.status,
          is_flagged: r.is_flagged,
          flag_reason: r.flag_reason,
          schedule_id: r.schedule_id || null,
          schedule_name: r.work_schedules?.name || null,
          has_break: r.work_schedules?.has_break ?? false,
          break_start_time: r.work_schedules?.break_start_time || null,
          break_end_time: r.work_schedules?.break_end_time || null,
        };
      });

      return res.status(200).json({
        success: true,
        summary: {
          total_present: totalPresent,
          total_late: totalLate,
          total_half_day: totalHalfDay,
          total_absent: totalAbsent,
          total_records: formatted.length,
        },
        records: formatted,
      });
    } catch (err) {
      console.error('My attendance error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * PUT /api/hrm/attendance/:id/resolve
   * Accessible by: owner, branch_manager
   */
  static async resolve(req, res) {
    try {
      const { id } = req.params;
      const { clock_out_time, notes } = req.body;

      // 1. Fetch attendance
      const { data: record, error: fetchErr } = await supabase
        .from('attendance')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !record) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Attendance record not found' },
        });
      }

      // Branch Manager check
      if (req.user.role === 'branch_manager') {
        const scopedIds = req.scopedBranchIds || [];
        if (!scopedIds.includes(record.branch_id)) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Access denied for this branch record' },
          });
        }
      }

      const updates = {
        is_flagged: false,
        flag_reason: null,
        admin_notes: notes || record.admin_notes,
      };

      if (clock_out_time) {
        updates.clock_out_time = new Date(clock_out_time).toISOString();
      }

      const { data: updated, error: updateErr } = await supabase
        .from('attendance')
        .update(updates)
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
        record: updated,
      });
    } catch (err) {
      console.error('Resolve attendance error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/attendance/daily-summary
   * Returns summary counts (total_employees, present, late, half_day, absent, not_marked) for date & branch.
   * Accessible by: owner, branch_manager
   */
  static async getDailySummary(req, res) {
    try {
      const { date, branch_id } = req.query;
      const targetDate = date || new Date().toISOString().split('T')[0];

      // 1. Fetch active employees & branch managers
      let query = supabase
        .from('users')
        .select(`
          id,
          name,
          email,
          role,
          is_active,
          branch_employee_assignments (
            branch_id
          ),
          branch_managers (
            branch_id
          )
        `)
        .in('role', ['employee', 'branch_manager'])
        .eq('is_active', true);

      const { data: rawEmployees, error: empErr } = await query;
      if (empErr) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: empErr.message },
        });
      }

      let employees = (rawEmployees || []).map((u) => {
        const empBranches = (u.branch_employee_assignments || []).map((a) => a.branch_id).filter(Boolean);
        const mgrBranches = (u.branch_managers || []).map((a) => a.branch_id).filter(Boolean);
        const branchIds = Array.from(new Set([...empBranches, ...mgrBranches]));
        return {
          id: u.id,
          branch_ids: branchIds,
        };
      });

      if (branch_id) {
        employees = employees.filter((e) => e.branch_ids.includes(branch_id));
      }

      if (req.user.role === 'branch_manager') {
        const scopedIds = new Set(req.scopedBranchIds || []);
        employees = employees.filter((e) => e.branch_ids.some((bId) => scopedIds.has(bId)));
      }

      const employeeIds = employees.map((e) => e.id);
      let attendanceMap = new Map();
      if (employeeIds.length > 0) {
        const { data: attendanceList, error: attErr } = await supabase
          .from('attendance')
          .select('employee_id, status')
          .in('employee_id', employeeIds)
          .eq('date', targetDate);

        if (attErr) {
          return res.status(500).json({
            success: false,
            error: { code: 'DB_ERROR', message: attErr.message },
          });
        }

        (attendanceList || []).forEach((record) => {
          attendanceMap.set(record.employee_id, record);
        });
      }

      // Fetch schedule overrides for these employees
      let scheduleOverrideMap = new Map();
      if (employeeIds.length > 0) {
        const { data: overrides } = await supabase
          .from('employee_schedule_overrides')
          .select('employee_id, schedule_id, work_schedules(*)')
          .in('employee_id', employeeIds);

        (overrides || []).forEach((ov) => {
          if (ov.work_schedules) {
            scheduleOverrideMap.set(ov.employee_id, ov.work_schedules);
          }
        });
      }

      // Fetch default work schedule
      const { data: defaultSchedule } = await supabase
        .from('work_schedules')
        .select('*')
        .eq('is_default', true)
        .maybeSingle();

      const fallbackSchedule = defaultSchedule || {
        start_time: '09:00:00',
        end_time: '18:00:00',
      };

      let presentCount = 0;
      let lateCount = 0;
      let halfDayCount = 0;
      let absentCount = 0;
      let notMarkedCount = 0;

      employees.forEach((emp) => {
        const att = attendanceMap.get(emp.id);
        const empSchedule = scheduleOverrideMap.get(emp.id) || fallbackSchedule;
        const attStatus = resolveEmployeeAttendanceStatus(att, empSchedule, targetDate);

        if (attStatus === 'present') presentCount++;
        else if (attStatus === 'late') lateCount++;
        else if (attStatus === 'half_day') halfDayCount++;
        else if (attStatus === 'absent') absentCount++;
        else notMarkedCount++;
      });

      return res.status(200).json({
        success: true,
        date: targetDate,
        summary: {
          total_employees: employees.length,
          present: presentCount,
          late: lateCount,
          half_day: halfDayCount,
          absent: absentCount,
          not_marked: notMarkedCount,
        },
      });
    } catch (err) {
      console.error('Get daily attendance summary error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/attendance/daily-roster
   * Returns employees attendance list filtered by date, branch, search, and status.
   * Accessible by: owner, branch_manager
   */
  static async getDailyRoster(req, res) {
    try {
      const { date, branch_id, status, search } = req.query;
      const targetDate = date || new Date().toISOString().split('T')[0];

      let query = supabase
        .from('users')
        .select(`
          id,
          name,
          email,
          role,
          is_active,
          employee_profiles (
            employee_code,
            department,
            phone_number
          ),
          branch_employee_assignments (
            branch_id,
            branches (
              id,
              name,
              address
            )
          ),
          branch_managers (
            branch_id,
            branches (
              id,
              name,
              address
            )
          )
        `)
        .in('role', ['employee', 'branch_manager'])
        .eq('is_active', true);

      if (search) {
        query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
      }

      const { data: rawEmployees, error: empErr } = await query.order('name', { ascending: true });
      if (empErr) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: empErr.message },
        });
      }

      let employees = (rawEmployees || []).map((u) => {
        const profile = Array.isArray(u.employee_profiles)
          ? u.employee_profiles[0]
          : u.employee_profiles;
        const empBranches = (u.branch_employee_assignments || [])
          .map((a) => a.branches)
          .filter(Boolean);
        const mgrBranches = (u.branch_managers || [])
          .map((a) => a.branches)
          .filter(Boolean);

        const branchMap = new Map();
        [...empBranches, ...mgrBranches].forEach((b) => branchMap.set(b.id, b));
        const branches = Array.from(branchMap.values());
        const branchIds = branches.map((b) => b.id);

        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          employee_code: profile?.employee_code || null,
          department: profile?.department || null,
          phone_number: profile?.phone_number || u.phone_number || null,
          branches,
          branch_ids: branchIds,
        };
      });

      if (branch_id) {
        employees = employees.filter((e) => e.branch_ids.includes(branch_id));
      }

      if (req.user.role === 'branch_manager') {
        const scopedIds = new Set(req.scopedBranchIds || []);
        employees = employees.filter((e) => e.branch_ids.some((bId) => scopedIds.has(bId)));
      }

      const employeeIds = employees.map((e) => e.id);
      let attendanceMap = new Map();
      if (employeeIds.length > 0) {
        const { data: attendanceList, error: attErr } = await supabase
          .from('attendance')
          .select('*')
          .in('employee_id', employeeIds)
          .eq('date', targetDate);

        if (attErr) {
          return res.status(500).json({
            success: false,
            error: { code: 'DB_ERROR', message: attErr.message },
          });
        }

        (attendanceList || []).forEach((record) => {
          attendanceMap.set(record.employee_id, record);
        });
      }

      // Fetch schedule overrides for these employees
      let scheduleOverrideMap = new Map();
      if (employeeIds.length > 0) {
        const { data: overrides } = await supabase
          .from('employee_schedule_overrides')
          .select('employee_id, schedule_id, work_schedules(*)')
          .in('employee_id', employeeIds);

        (overrides || []).forEach((ov) => {
          if (ov.work_schedules) {
            scheduleOverrideMap.set(ov.employee_id, ov.work_schedules);
          }
        });
      }

      // Fetch default work schedule
      const { data: defaultSchedule } = await supabase
        .from('work_schedules')
        .select('*')
        .eq('is_default', true)
        .maybeSingle();

      const fallbackSchedule = defaultSchedule || {
        start_time: '09:00:00',
        end_time: '18:00:00',
      };

      let roster = employees.map((emp) => {
        const att = attendanceMap.get(emp.id);
        const empSchedule = scheduleOverrideMap.get(emp.id) || fallbackSchedule;
        const attStatus = resolveEmployeeAttendanceStatus(att, empSchedule, targetDate);
        const isPresent = ['present', 'late', 'half_day'].includes(attStatus);

        let isFlagged = Boolean(att?.is_flagged);
        let flagReason = att?.flag_reason || null;

        if (!isFlagged && att?.clock_in_time && empSchedule?.start_time) {
          const lateMins = computeLateMinutes(new Date(att.clock_in_time), empSchedule);
          if (lateMins > 0 || attStatus === 'late') {
            isFlagged = true;
            flagReason = flagReason || `Late arrival (${lateMins} min late)`;
          }
        }

        if (att?.clock_out_time && empSchedule?.end_time) {
          const shiftEndMins = parseTimeToMinutes(empSchedule.end_time);
          const outDate = new Date(att.clock_out_time);
          const outMins = outDate.getHours() * 60 + outDate.getMinutes();
          if (outMins < shiftEndMins - 15) {
            const earlyMins = shiftEndMins - outMins;
            const earlyText = `${earlyMins} min early departure`;
            isFlagged = true;
            flagReason = flagReason ? (flagReason.includes('early') ? flagReason : `${flagReason}, ${earlyText}`) : earlyText;
          }
        }

        return {
          id: emp.id,
          name: emp.name,
          email: emp.email,
          employee_code: emp.employee_code,
          department: emp.department,
          phone_number: emp.phone_number || null,
          branches: emp.branches,
          is_present: isPresent,
          attendance_status: attStatus,
          attendance_id: att?.id || null,
          clock_in_time: att?.clock_in_time || null,
          clock_out_time: att?.clock_out_time || null,
          lunch_start_time: att?.lunch_start_time || null,
          lunch_end_time: att?.lunch_end_time || null,
          lunch_duration_minutes: att?.lunch_duration_minutes || null,
          is_on_lunch: Boolean(att?.lunch_start_time && !att?.lunch_end_time),
          is_flagged: isFlagged,
          flag_reason: flagReason,
          admin_notes: att?.admin_notes || null,
        };
      });

      if (status && status !== 'all') {
        if (status === 'present') {
          roster = roster.filter((e) => e.is_present);
        } else {
          roster = roster.filter((e) => e.attendance_status === status);
        }
      }

      return res.status(200).json({
        success: true,
        date: targetDate,
        employees: roster,
      });
    } catch (err) {
      console.error('Get daily attendance roster error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  static async getDailyStatus(req, res) {
    try {
      const { date, branch_id, status, search } = req.query;
      const targetDate = date || new Date().toISOString().split('T')[0];

      // 1. Fetch active employees & branch managers
      let query = supabase
        .from('users')
        .select(`
          id,
          name,
          email,
          role,
          is_active,
          employee_profiles (
            employee_code,
            department,
            phone_number
          ),
          branch_employee_assignments (
            branch_id,
            branches (
              id,
              name,
              address
            )
          ),
          branch_managers (
            branch_id,
            branches (
              id,
              name,
              address
            )
          )
        `)
        .in('role', ['employee', 'branch_manager'])
        .eq('is_active', true);

      if (search) {
        query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
      }

      const { data: rawEmployees, error: empErr } = await query.order('name', { ascending: true });

      if (empErr) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: empErr.message },
        });
      }

      // Format employees and apply branch / scoping filters
      let employees = (rawEmployees || []).map((u) => {
        const profile = Array.isArray(u.employee_profiles)
          ? u.employee_profiles[0]
          : u.employee_profiles;
        const empBranches = (u.branch_employee_assignments || [])
          .map((a) => a.branches)
          .filter(Boolean);
        const mgrBranches = (u.branch_managers || [])
          .map((a) => a.branches)
          .filter(Boolean);

        const branchMap = new Map();
        [...empBranches, ...mgrBranches].forEach((b) => branchMap.set(b.id, b));
        const branches = Array.from(branchMap.values());
        const branchIds = branches.map((b) => b.id);

        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          employee_code: profile?.employee_code || null,
          department: profile?.department || null,
          phone_number: profile?.phone_number || u.phone_number || null,
          branches,
          branch_ids: branchIds,
        };
      });

      // Filter by branch_id if provided
      if (branch_id) {
        employees = employees.filter((e) => e.branch_ids.includes(branch_id));
      }

      // Filter by branch_manager scope if applicable
      if (req.user.role === 'branch_manager') {
        const scopedIds = new Set(req.scopedBranchIds || []);
        employees = employees.filter((e) => e.branch_ids.some((bId) => scopedIds.has(bId)));
      }

      const employeeIds = employees.map((e) => e.id);

      // 2. Fetch all work schedules
      const { data: allSchedules } = await supabase.from('work_schedules').select('*');
      const scheduleMap = new Map((allSchedules || []).map((s) => [s.id, s]));
      const defaultSchedule =
        (allSchedules || []).find((s) => s.is_default) ||
        allSchedules?.[0] || {
          id: null,
          start_time: '09:00:00',
          end_time: '18:00:00',
          name: 'Standard Shift',
        };

      // Fetch shift assignments for all employees
      const { data: shiftAssignments } = await supabase
        .from('employee_shift_assignments')
        .select('employee_id, schedule_id, salary')
        .in('employee_id', employeeIds);

      const empShiftAssignmentsMap = new Map();
      (shiftAssignments || []).forEach((sa) => {
        if (!empShiftAssignmentsMap.has(sa.employee_id)) {
          empShiftAssignmentsMap.set(sa.employee_id, []);
        }
        const sch = scheduleMap.get(sa.schedule_id);
        if (sch) empShiftAssignmentsMap.get(sa.employee_id).push(sch);
      });

      // Fetch schedule overrides for these employees
      const { data: overrides } = await supabase
        .from('employee_schedule_overrides')
        .select('employee_id, schedule_id, work_schedules(*)')
        .in('employee_id', employeeIds);

      const scheduleOverrideMap = new Map();
      (overrides || []).forEach((ov) => {
        if (ov.work_schedules) {
          scheduleOverrideMap.set(ov.employee_id, ov.work_schedules);
        }
      });

      // Fetch attendance records for these employees on targetDate
      let empAttendanceMap = new Map();
      if (employeeIds.length > 0) {
        const { data: attendanceList, error: attErr } = await supabase
          .from('attendance')
          .select('*')
          .in('employee_id', employeeIds)
          .eq('date', targetDate);

        if (attErr) {
          return res.status(500).json({
            success: false,
            error: { code: 'DB_ERROR', message: attErr.message },
          });
        }

        (attendanceList || []).forEach((record) => {
          if (!empAttendanceMap.has(record.employee_id)) {
            empAttendanceMap.set(record.employee_id, []);
          }
          empAttendanceMap.get(record.employee_id).push(record);
        });
      }

      // 3. Merge attendance with employees & compute summary counts
      let presentCount = 0;
      let lateCount = 0;
      let halfDayCount = 0;
      let absentCount = 0;
      let notMarkedCount = 0;

      let roster = employees.map((emp) => {
        const assignedShifts = empShiftAssignmentsMap.get(emp.id) || [];
        const effectiveShifts =
          assignedShifts.length > 0
            ? assignedShifts
            : [scheduleOverrideMap.get(emp.id) || defaultSchedule];

        const attList = empAttendanceMap.get(emp.id) || [];

        const shifts = effectiveShifts.map((sch) => {
          let att = attList.find((a) => a.schedule_id === sch.id);
          if (!att && attList.length === 1 && !attList[0].schedule_id) {
            att = attList[0];
          }

          const attStatus = resolveEmployeeAttendanceStatus(att, sch, targetDate);

          let isFlagged = Boolean(att?.is_flagged);
          let flagReason = att?.flag_reason || null;

          if (!isFlagged && att?.clock_in_time && sch?.start_time) {
            const lateMins = computeLateMinutes(new Date(att.clock_in_time), sch);
            if (lateMins > 0 || attStatus === 'late') {
              isFlagged = true;
              flagReason = flagReason || `Late arrival (${lateMins} min late)`;
            }
          }

          if (att?.clock_out_time && sch?.end_time) {
            const shiftEndMins = parseTimeToMinutes(sch.end_time);
            const outDate = new Date(att.clock_out_time);
            const outMins = outDate.getHours() * 60 + outDate.getMinutes();
            if (outMins < shiftEndMins - 15) {
              const earlyMins = shiftEndMins - outMins;
              const earlyText = `${earlyMins} min early departure`;
              isFlagged = true;
              flagReason = flagReason ? (flagReason.includes('early') ? flagReason : `${flagReason}, ${earlyText}`) : earlyText;
            }
          }

          return {
            schedule_id: sch.id,
            schedule_name: sch.name || 'Day Shift',
            start_time: sch.start_time,
            end_time: sch.end_time,
            has_break: sch.has_break ?? false,
            break_start_time: sch.break_start_time || null,
            break_end_time: sch.break_end_time || null,
            clock_in_time: att?.clock_in_time || null,
            clock_out_time: att?.clock_out_time || null,
            lunch_start_time: att?.lunch_start_time || null,
            lunch_end_time: att?.lunch_end_time || null,
            lunch_duration_minutes: att?.lunch_duration_minutes || null,
            is_on_lunch: Boolean(att?.lunch_start_time && !att?.lunch_end_time),
            status: attStatus,
            attendance_status: attStatus,
            attendance_id: att?.id || null,
            is_flagged: isFlagged,
            flag_reason: flagReason,
            admin_notes: att?.admin_notes || null,
          };
        });

        // Derive aggregate status
        const hasPresent = shifts.some((s) => s.status === 'present');
        const hasLateStatus = shifts.some((s) => s.status === 'late');
        const hasHalfDay = shifts.some((s) => s.status === 'half_day');
        const hasAbsent = shifts.some((s) => s.status === 'absent');
        const isFlagged = shifts.some((s) => s.is_flagged);
        const flaggedShift = shifts.find((s) => s.is_flagged);
        const isFlaggedLate = shifts.some((s) =>
          String(s.flag_reason || '').toLowerCase().includes('late')
        );

        const isLate = hasLateStatus || isFlaggedLate;
        const isHalfDayAndLate = hasHalfDay && isLate;

        let overallStatus = 'not_marked';
        if (hasHalfDay) {
          overallStatus = isLate ? 'half_day_late' : 'half_day';
        } else if (hasLateStatus) {
          overallStatus = 'late';
        } else if (hasPresent) {
          overallStatus = isLate ? 'late' : 'present';
        } else if (hasAbsent) {
          overallStatus = 'absent';
        }

        if (overallStatus === 'present') presentCount++;
        else if (overallStatus === 'late') lateCount++;
        else if (overallStatus === 'half_day' || overallStatus === 'half_day_late') halfDayCount++;
        else if (overallStatus === 'absent') absentCount++;
        else notMarkedCount++;

        // If employee is on half day and also late, also increment lateCount
        if (isHalfDayAndLate && overallStatus === 'half_day_late') {
          lateCount++;
        }

        const primaryShift = shifts[0] || {};
        const isPresent = ['present', 'late', 'half_day', 'half_day_late'].includes(overallStatus);

        return {
          id: emp.id,
          name: emp.name,
          email: emp.email,
          employee_code: emp.employee_code,
          department: emp.department,
          phone_number: emp.phone_number || null,
          branches: emp.branches,
          branch_name: emp.branches?.[0]?.name || null,
          branch_id: emp.branch_ids?.[0] || null,
          is_present: isPresent,
          is_late: isLate,
          is_half_day: hasHalfDay,
          is_half_day_and_late: isHalfDayAndLate,
          status: overallStatus,
          attendance_status: overallStatus,
          attendance_id: primaryShift.attendance_id || null,
          clock_in_time: primaryShift.clock_in_time || null,
          clock_out_time: primaryShift.clock_out_time || null,
          lunch_start_time: primaryShift.lunch_start_time || null,
          lunch_end_time: primaryShift.lunch_end_time || null,
          lunch_duration_minutes: primaryShift.lunch_duration_minutes || null,
          is_on_lunch: primaryShift.is_on_lunch || false,
          is_flagged: isFlagged,
          flag_reason: flaggedShift?.flag_reason || primaryShift.flag_reason || null,
          admin_notes: primaryShift.admin_notes || null,
          shifts,
        };
      });

      const uniquePresentCount = roster.filter((e) => e.is_present).length;
      const flaggedCount = roster.filter((e) => e.is_flagged).length;

      const summaryPayload = {
        total: employees.length,
        total_employees: employees.length,
        present: uniquePresentCount,
        total_present: uniquePresentCount,
        on_time: presentCount,
        late: lateCount,
        half_day: halfDayCount,
        absent: absentCount,
        not_marked: notMarkedCount,
        flagged: flaggedCount,
      };

      // 4. Filter by status if requested
      if (status && status !== 'all') {
        if (status === 'present') {
          roster = roster.filter((e) => e.is_present);
        } else if (status === 'late') {
          roster = roster.filter(
            (e) => e.is_late || e.status === 'late' || e.status === 'half_day_late'
          );
        } else if (status === 'half_day') {
          roster = roster.filter(
            (e) => e.is_half_day || e.status === 'half_day' || e.status === 'half_day_late'
          );
        } else if (status === 'absent') {
          roster = roster.filter((e) => e.status === 'absent');
        } else if (status === 'not_marked') {
          roster = roster.filter((e) => e.status === 'not_marked');
        } else if (status === 'flagged') {
          roster = roster.filter((e) => e.is_flagged);
        } else {
          roster = roster.filter((e) => e.attendance_status === status || e.status === status);
        }
      }

      return res.status(200).json({
        success: true,
        date: targetDate,
        summary: summaryPayload,
        records: roster,
        employees: roster,
      });
    } catch (err) {
      console.error('Get daily attendance status error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * POST /api/hrm/attendance/auto-flag
   * Internal cron endpoint protected by CRON_SECRET header
   */
  static async autoFlag(req, res) {
    try {
      const authHeader = req.headers['x-cron-secret'] || req.headers['authorization'];
      const expectedSecret = process.env.CRON_SECRET || 'attendy_internal_cron_secret';

      const provided = authHeader?.replace(/^Bearer\s+/i, '');
      if (!provided || provided !== expectedSecret) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED_CRON', message: 'Invalid cron secret header' },
        });
      }

      const result = await AttendanceService.autoFlagDaily();
      return res.status(200).json(result);
    } catch (err) {
      console.error('Auto flag error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * POST /api/hrm/attendance/manual
   * Accessible by: owner, branch_manager
   */
  static async manualPunch(req, res) {
    try {
      const { employee_id, action, branch_id, time, admin_notes, schedule_id } = req.body;
      const result = await AttendanceService.manualPunch({
        employee_id,
        action,
        branch_id,
        time,
        admin_notes,
        schedule_id,
      });
      return res.status(200).json(result);
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: {
          code: err.code || 'MANUAL_PUNCH_FAILED',
          message: err.message || 'Failed to log manual attendance',
        },
      });
    }
  }
}

export default AttendanceController;
