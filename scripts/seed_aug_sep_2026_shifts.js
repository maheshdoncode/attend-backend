import { supabase } from '../src/db/supabase.js';

async function seedAttendance() {
  console.log('🚀 Starting Attendance Seeding for August 2026 & September 2026 (till Sept 23)...');

  // 1. Fetch work schedules
  const { data: schedules } = await supabase.from('work_schedules').select('*');
  const dayShift = schedules.find((s) => s.name === 'Day Shift') || schedules[0];
  const nightShift = schedules.find((s) => s.name === 'Night Shift');

  console.log('Day Shift:', dayShift?.id, dayShift?.name, dayShift?.start_time, '-', dayShift?.end_time);
  console.log('Night Shift:', nightShift?.id, nightShift?.name, nightShift?.start_time, '-', nightShift?.end_time);

  // 2. Fetch all employees & branch assignments
  const { data: users, error: uErr } = await supabase
    .from('users')
    .select(`
      id,
      name,
      email,
      role,
      employee_profiles (
        employee_code,
        monthly_salary,
        department
      ),
      branch_employee_assignments (
        branch_id,
        branches (
          id,
          name,
          latitude,
          longitude
        )
      )
    `)
    .in('role', ['employee', 'branch_manager'])
    .eq('is_active', true);

  if (uErr || !users) {
    console.error('Failed to fetch users:', uErr);
    return;
  }

  // 3. Ensure Mahesh has an employee_shift_assignment if not exists
  const { data: existingAssignments } = await supabase.from('employee_shift_assignments').select('*');
  const mahesh = users.find((u) => u.name === 'Mahesh');
  if (mahesh && !existingAssignments.some((a) => a.employee_id === mahesh.id)) {
    console.log('Adding Day Shift assignment for Mahesh...');
    await supabase.from('employee_shift_assignments').insert({
      employee_id: mahesh.id,
      schedule_id: dayShift.id,
      salary: 50000,
    });
  }

  // 4. Fetch up-to-date shift assignments
  const { data: shiftAssignments } = await supabase.from('employee_shift_assignments').select('*');

  // Fetch working days overrides (working Sundays)
  const { data: overrides } = await supabase
    .from('working_days_overrides')
    .select('*')
    .gte('date', '2026-08-01')
    .lte('date', '2026-09-30');

  const workingSundayOverrides = overrides || [];

  // Generate date ranges
  const dateList = [];

  // August 2026 (1 to 31)
  for (let d = 1; d <= 31; d++) {
    const dayStr = String(d).padStart(2, '0');
    dateList.push({
      dateStr: `2026-08-${dayStr}`,
      dateObj: new Date(2026, 7, d),
      dayNumber: d,
      month: 8,
    });
  }

  // September 2026 (1 to 23)
  for (let d = 1; d <= 23; d++) {
    const dayStr = String(d).padStart(2, '0');
    dateList.push({
      dateStr: `2026-09-${dayStr}`,
      dateObj: new Date(2026, 8, d),
      dayNumber: d,
      month: 9,
    });
  }

  console.log(`\n📅 Generated ${dateList.length} total calendar days to process.`);

  let totalInserted = 0;

  for (const user of users) {
    const branchInfo = user.branch_employee_assignments?.[0]?.branches || {
      id: '5c21f7b8-0436-41e7-8845-17a3bd0d0735',
      name: 'Kapodra',
      latitude: 21.218942,
      longitude: 72.869527,
    };

    const branchId = branchInfo.id;
    const branchLat = Number(branchInfo.latitude) || 21.218942;
    const branchLng = Number(branchInfo.longitude) || 72.869527;

    // Get assigned shifts for this employee
    let userShifts = (shiftAssignments || []).filter((a) => a.employee_id === user.id);
    if (userShifts.length === 0) {
      userShifts = [{ schedule_id: dayShift.id }];
    }

    console.log(`\n👤 User: ${user.name} (${user.employee_profiles?.employee_code || user.role})`);
    console.log(`   Branch: ${branchInfo.name}, Shifts count: ${userShifts.length}`);

    const recordsToInsert = [];

    for (const { dateStr, dateObj, dayNumber, month } of dateList) {
      const dayOfWeek = dateObj.getDay(); // 0 is Sunday

      // Check if Sunday is a special working Sunday for this user or branch
      let isWorkingDay = dayOfWeek !== 0;
      if (dayOfWeek === 0) {
        const isOverride = workingSundayOverrides.some((o) => {
          if (o.date !== dateStr) return false;
          if (o.employee_id && o.employee_id === user.id) return true;
          if (!o.employee_id && (!o.branch_id || o.branch_id === branchId)) return true;
          return false;
        });
        if (isOverride) {
          isWorkingDay = true;
        }
      }

      // If regular Sunday off, skip punch records
      if (!isWorkingDay) {
        continue;
      }

      // Generate attendance for EACH assigned shift
      for (const shift of userShifts) {
        const schedule = schedules.find((s) => s.id === shift.schedule_id) || dayShift;
        const isNight = schedule.name?.toLowerCase().includes('night');

        // Deterministic realistic patterns per employee & shift
        let status = 'present';
        let adminNotes = null;
        let clockInTime = null;
        let clockOutTime = null;

        // Custom variations based on day number and user
        const seedVal = (user.name.charCodeAt(0) + dayNumber * 7 + (isNight ? 13 : 0) + month * 19) % 100;

        if (seedVal < 5) {
          // Absent (5% chance)
          status = 'absent';
          adminNotes = 'Unplanned absence';
        } else if (seedVal < 14) {
          // Late arrival (9% chance)
          status = 'late';
          if (isNight) {
            // Night shift starts at 20:00 IST (14:30 UTC)
            const lateMin = 15 + (seedVal % 20); // 15 - 34 mins late -> 20:15 - 20:34 IST (14:45 - 15:04 UTC)
            const lateUtcMin = 30 + lateMin;
            const utcHour = 14 + Math.floor(lateUtcMin / 60);
            const utcMin = lateUtcMin % 60;
            clockInTime = `${dateStr}T${String(utcHour).padStart(2, '0')}:${String(utcMin).padStart(2, '0')}:15.000Z`;
            clockOutTime = `${dateStr}T17:38:45.000Z`; // 23:08 IST
            adminNotes = `Late check-in (${lateMin} mins)`;
          } else {
            // Day shift starts at 09:00 IST (03:30 UTC)
            const lateMin = 25 + (seedVal % 15); // 25 - 39 mins late -> 09:25 - 09:39 IST (03:55 - 04:09 UTC)
            const lateUtcMin = 30 + lateMin;
            const utcHour = 3 + Math.floor(lateUtcMin / 60);
            const utcMin = lateUtcMin % 60;
            clockInTime = `${dateStr}T${String(utcHour).padStart(2, '0')}:${String(utcMin).padStart(2, '0')}:22.000Z`;
            clockOutTime = `${dateStr}T12:42:10.000Z`; // 18:12 IST
            adminNotes = `Late check-in (${lateMin} mins)`;
          }
        } else if (seedVal < 20) {
          // Half day (6% chance)
          status = 'half_day';
          if (isNight) {
            clockInTime = `${dateStr}T14:30:00.000Z`; // 20:00 IST
            clockOutTime = `${dateStr}T16:00:00.000Z`; // 21:30 IST (1.5 hrs worked)
            adminNotes = 'Half shift completed';
          } else {
            clockInTime = `${dateStr}T03:32:10.000Z`; // 09:02 IST
            clockOutTime = `${dateStr}T07:30:00.000Z`; // 13:00 IST (3.5 hrs worked)
            adminNotes = 'First half attended';
          }
        } else {
          // Present on time (80% chance)
          status = 'present';
          const inJitter = seedVal % 4;
          const outJitter = seedVal % 12;
          if (isNight) {
            // 19:56 - 19:59 IST (14:26 - 14:29 UTC)
            clockInTime = `${dateStr}T14:2${6 + (inJitter % 4)}:30.000Z`;
            clockOutTime = `${dateStr}T17:${30 + outJitter}:15.000Z`; // 23:00 - 23:12 IST (17:30 - 17:42 UTC)
          } else {
            // 08:56 - 08:59 IST (03:26 - 03:29 UTC)
            clockInTime = `${dateStr}T03:2${6 + (inJitter % 4)}:40.000Z`;
            clockOutTime = `${dateStr}T12:${30 + outJitter}:20.000Z`; // 18:00 - 18:12 IST (12:30 - 12:42 UTC)
          }
        }

        // Slight coordinate jitter within 20m of branch
        const latJitter = (Math.random() - 0.5) * 0.0001;
        const lngJitter = (Math.random() - 0.5) * 0.0001;

        recordsToInsert.push({
          employee_id: user.id,
          branch_id: branchId,
          schedule_id: schedule.id,
          date: dateStr,
          clock_in_time: clockInTime,
          clock_in_lat: clockInTime ? Number((branchLat + latJitter).toFixed(6)) : null,
          clock_in_lng: clockInTime ? Number((branchLng + lngJitter).toFixed(6)) : null,
          clock_out_time: clockOutTime,
          clock_out_lat: clockOutTime ? Number((branchLat + latJitter).toFixed(6)) : null,
          clock_out_lng: clockOutTime ? Number((branchLng + lngJitter).toFixed(6)) : null,
          status,
          is_flagged: false,
          flag_reason: null,
          admin_notes: adminNotes,
        });
      }
    }

    // Insert in batches of 50
    console.log(`   Inserting ${recordsToInsert.length} shift attendance records...`);
    for (let i = 0; i < recordsToInsert.length; i += 50) {
      const chunk = recordsToInsert.slice(i, i + 50);
      const { error: insErr } = await supabase.from('attendance').insert(chunk);
      if (insErr) {
        console.error(`❌ Batch insert error for ${user.name}:`, insErr.message);
      } else {
        totalInserted += chunk.length;
      }
    }
  }

  console.log(`\n🎉 DONE! Successfully seeded ${totalInserted} shift-wise attendance records for all employees across August 2026 and September 2026 (till 23 Sept).`);
}

seedAttendance().catch(console.error);
