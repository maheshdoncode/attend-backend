import { supabase } from '../db/supabase.js';
import { AttendanceService } from '../services/attendance.service.js';
import { parseTimeToMinutes } from '../utils/schedule.js';

export const resolveEmployeeAttendanceStatus = (att, schedule, targetDate) => {
  const explicitStatus = typeof att === 'string' ? att : att?.status;
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
          status,
          is_flagged,
          flag_reason,
          schedule_id,
          branches (name),
          work_schedules (id, name, start_time, end_time)
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
          status: r.status,
          is_flagged: r.is_flagged,
          flag_reason: r.flag_reason,
          schedule_id: r.schedule_id || null,
          schedule_name: r.work_schedules?.name || null,
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
          is_flagged: att?.is_flagged || false,
          flag_reason: att?.flag_reason || null,
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

      // 2. Fetch attendance records for these employees on targetDate
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

      // 3. Merge attendance with employees & compute summary counts
      let presentCount = 0;
      let lateCount = 0;
      let halfDayCount = 0;
      let absentCount = 0;
      let notMarkedCount = 0;

      let roster = employees.map((emp) => {
        const att = attendanceMap.get(emp.id);
        const empSchedule = scheduleOverrideMap.get(emp.id) || fallbackSchedule;
        const attStatus = resolveEmployeeAttendanceStatus(att, empSchedule, targetDate);
        const isPresent = ['present', 'late', 'half_day'].includes(attStatus);

        if (attStatus === 'present') presentCount++;
        else if (attStatus === 'late') lateCount++;
        else if (attStatus === 'half_day') halfDayCount++;
        else if (attStatus === 'absent') absentCount++;
        else notMarkedCount++;

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
          status: attStatus,
          attendance_status: attStatus,
          attendance_id: att?.id || null,
          clock_in_time: att?.clock_in_time || null,
          clock_out_time: att?.clock_out_time || null,
          is_flagged: att?.is_flagged || false,
          flag_reason: att?.flag_reason || null,
          admin_notes: att?.admin_notes || null,
        };
      });

      // 4. Filter by status if requested
      if (status && status !== 'all') {
        if (status === 'present') {
          roster = roster.filter((e) => e.is_present);
        } else {
          roster = roster.filter((e) => e.attendance_status === status || e.status === status);
        }
      }

      return res.status(200).json({
        success: true,
        date: targetDate,
        summary: {
          total: employees.length,
          total_employees: employees.length,
          present: presentCount,
          late: lateCount,
          half_day: halfDayCount,
          absent: absentCount,
          not_marked: notMarkedCount,
        },
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
