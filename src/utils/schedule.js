import { supabase } from '../db/supabase.js';

/**
 * Parses time string (e.g. '09:00:00' or '09:00') into total minutes from midnight.
 * @param {string} timeStr
 * @returns {number}
 */
export const parseTimeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map(Number);
  const hours = parts[0] || 0;
  const minutes = parts[1] || 0;
  return hours * 60 + minutes;
};

/**
 * Gets minutes from midnight from a Date object or ISO string.
 * @param {Date|string} dateInput
 * @returns {number}
 */
export const getMinutesFromMidnight = (dateInput) => {
  const d = new Date(dateInput);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
};

/**
 * Fetches the effective work schedule for an employee (override if exists, else default schedule).
 * @param {string} employee_id
 * @returns {Promise<object>}
 */
export const getEmployeeSchedule = async (employee_id) => {
  // 1. Check for employee schedule override
  const { data: override, error: overrideError } = await supabase
    .from('employee_schedule_overrides')
    .select('schedule_id, work_schedules(*)')
    .eq('employee_id', employee_id)
    .maybeSingle();

  if (!overrideError && override && override.work_schedules) {
    return override.work_schedules;
  }

  // 2. Fetch default schedule
  const { data: defaultSchedule, error: defaultError } = await supabase
    .from('work_schedules')
    .select('*')
    .eq('is_default', true)
    .maybeSingle();

  if (defaultSchedule) {
    return defaultSchedule;
  }

  // 3. Fallback to any active schedule or standard 09:00-18:00
  const { data: fallbackSchedule } = await supabase
    .from('work_schedules')
    .select('*')
    .limit(1)
    .maybeSingle();

  return (
    fallbackSchedule || {
      id: null,
      name: 'Standard Shift',
      start_time: '09:00:00',
      end_time: '18:00:00',
      is_default: true,
    }
  );
};

/**
 * Checks if a given date string (YYYY-MM-DD) is a holiday for a branch or globally.
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {string|null} branch_id
 * @returns {Promise<boolean>}
 */
export const isHoliday = async (dateStr, branch_id = null) => {
  let query = supabase.from('holidays').select('id, branch_id').eq('date', dateStr);

  if (branch_id) {
    // Holiday applies if branch_id matches OR branch_id is null (global holiday)
    query = query.or(`branch_id.eq.${branch_id},branch_id.is.null`);
  } else {
    query = query.is('branch_id', null);
  }

  const { data, error } = await query;
  if (error || !data) return false;
  return data.length > 0;
};

/**
 * Computes how many minutes after schedule start the employee clocked in (0 if on time).
 * @param {Date|string} clockInTime
 * @param {string} scheduleStartTime - 'HH:MM' or 'HH:MM:SS'
 * @returns {number}
 */
export const computeLateMinutes = (clockInTime, scheduleStartTime) => {
  const clockInMinutes = getMinutesFromMidnight(clockInTime);
  const scheduleMinutes = parseTimeToMinutes(scheduleStartTime);
  const diff = Math.floor(clockInMinutes - scheduleMinutes);
  return Math.max(0, diff);
};

/**
 * Determines if clock in time is after the midpoint of schedule start -> end.
 * @param {Date|string} clockInTime
 * @param {object} schedule - { start_time: '09:00', end_time: '18:00' }
 * @returns {boolean}
 */
export const isHalfDay = (clockInTime, schedule) => {
  if (!schedule || !schedule.start_time || !schedule.end_time) return false;
  const startMinutes = parseTimeToMinutes(schedule.start_time);
  let endMinutes = parseTimeToMinutes(schedule.end_time);

  // If shift spans midnight, add 24 hours
  if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60;
  }

  const midpointMinutes = startMinutes + (endMinutes - startMinutes) / 2;
  const clockInMinutes = getMinutesFromMidnight(clockInTime);

  return clockInMinutes > midpointMinutes;
};


/**
 * Fetches all assigned work schedules and salaries for an employee.
 * @param {string} employee_id
 * @returns {Promise<Array<{ assignment_id: string|null, schedule_id: string, salary: number, schedule: object }>>}
 */
export const getEmployeeSchedules = async (employee_id) => {
  const { data: assignments, error: assignErr } = await supabase
    .from('employee_shift_assignments')
    .select('id, schedule_id, salary, work_schedules(*)')
    .eq('employee_id', employee_id);

  if (!assignErr && assignments && assignments.length > 0) {
    return assignments
      .filter((a) => a.work_schedules)
      .map((a) => ({
        assignment_id: a.id,
        schedule_id: a.schedule_id,
        salary: Number(a.salary) || 0,
        schedule: a.work_schedules,
      }));
  }

  const { data: override } = await supabase
    .from('employee_schedule_overrides')
    .select('schedule_id, work_schedules(*)')
    .eq('employee_id', employee_id)
    .maybeSingle();

  if (override && override.work_schedules) {
    return [
      {
        assignment_id: null,
        schedule_id: override.schedule_id,
        salary: 0,
        schedule: override.work_schedules,
      },
    ];
  }

  const defaultSchedule = await getEmployeeSchedule(employee_id);
  return [
    {
      assignment_id: null,
      schedule_id: defaultSchedule?.id || null,
      salary: 0,
      schedule: defaultSchedule,
    },
  ];
};

/**
 * Determines which assigned shift the employee is clocking into based on current time and today's completed attendance.
 * @param {string} employee_id
 * @param {Date} now
 * @param {Array<object>} todayAttendance
 * @returns {Promise<object>}
 */
export const getEmployeeActiveShift = async (employee_id, now = new Date(), todayAttendance = []) => {
  const assigned = await getEmployeeSchedules(employee_id);
  if (assigned.length === 1) {
    return assigned[0].schedule;
  }

  const currentMins = getMinutesFromMidnight(now);
  const completedScheduleIds = new Set(
    todayAttendance
      .filter((a) => a.clock_out_time != null)
      .map((a) => a.schedule_id)
      .filter(Boolean)
  );

  const availableShifts = assigned.filter((a) => !completedScheduleIds.has(a.schedule_id));
  const candidateShifts = availableShifts.length > 0 ? availableShifts : assigned;

  let bestShift = candidateShifts[0].schedule;
  let minDiff = Infinity;

  for (const item of candidateShifts) {
    const s = item.schedule;
    if (!s || !s.start_time) continue;
    const startMins = parseTimeToMinutes(s.start_time);
    let diff = Math.abs(currentMins - startMins);
    const endMins = parseTimeToMinutes(s.end_time);
    if (currentMins >= startMins - 120 && currentMins <= endMins + 60) {
      diff -= 500;
    }
    if (diff < minDiff) {
      minDiff = diff;
      bestShift = s;
    }
  }

  return bestShift;
};

export default {
  parseTimeToMinutes,
  getMinutesFromMidnight,
  getEmployeeSchedule,
  isHoliday,
  computeLateMinutes,
  isHalfDay,
  getEmployeeSchedules,
  getEmployeeActiveShift,
};
