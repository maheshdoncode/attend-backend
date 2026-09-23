import { supabase } from '../src/db/supabase.js';

const EMP_IDS = [
  '64d7d71f-2300-4dde-a70f-b6cc93cad373',
  '7607e95f-5905-4dfe-9c56-4b477019a64e',
];

async function seedSeptemberAttendance() {
  console.log('Fetching user and branch details for:', EMP_IDS);

  const { data: users, error: userErr } = await supabase
    .from('users')
    .select(`
      id,
      name,
      email,
      role,
      branch_employee_assignments(branch_id),
      branch_managers(branch_id)
    `)
    .in('id', EMP_IDS);

  if (userErr || !users) {
    console.error('Error fetching users:', userErr);
    return;
  }

  console.log('Found users:', users.map((u) => ({ id: u.id, name: u.name, role: u.role })));

  // Fetch branches as fallback
  const { data: branches } = await supabase.from('branches').select('id, name, latitude, longitude').limit(1);
  const defaultBranch = branches?.[0];

  const attendanceRecords = [];
  const year = 2026;
  const month = 9; // September
  const daysInMonth = 30;

  for (const user of users) {
    const branchId =
      user.branch_employee_assignments?.[0]?.branch_id ||
      user.branch_managers?.[0]?.branch_id ||
      defaultBranch?.id;

    console.log(`Processing user ${user.name} (${user.id}) with branch ${branchId}`);

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(Date.UTC(year, month - 1, day));
      const dayOfWeek = dateObj.getUTCDay(); // 0 is Sunday
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      // Skip Sundays (standard rest day)
      if (dayOfWeek === 0) {
        continue;
      }

      // Generate realistic attendance statuses:
      // ~85% present on-time
      // ~10% late
      // ~5% half-day
      let status = 'present';
      let clockInTime = '08:55:00';
      let clockOutTime = '18:05:00';

      if (day === 4 || day === 15) {
        status = 'late';
        clockInTime = '09:25:00';
        clockOutTime = '18:10:00';
      } else if (day === 9) {
        status = 'half_day';
        clockInTime = '08:50:00';
        clockOutTime = '13:30:00';
      } else if (day === 22) {
        status = 'late';
        clockInTime = '09:18:00';
        clockOutTime = '18:00:00';
      } else {
        const minIn = 50 + (day % 9);
        const minOut = 5 + ((day * 2) % 15);
        clockInTime = `08:${String(minIn).padStart(2, '0')}:00`;
        clockOutTime = `18:${String(minOut).padStart(2, '0')}:00`;
      }

      const clockInIso = `${dateStr}T${clockInTime}.000Z`;
      const clockOutIso = `${dateStr}T${clockOutTime}.000Z`;

      attendanceRecords.push({
        employee_id: user.id,
        branch_id: branchId,
        date: dateStr,
        clock_in_time: clockInIso,
        clock_out_time: clockOutIso,
        status: status,
        clock_in_lat: defaultBranch?.latitude || 21.1702,
        clock_in_lng: defaultBranch?.longitude || 72.8311,
        clock_out_lat: defaultBranch?.latitude || 21.1702,
        clock_out_lng: defaultBranch?.longitude || 72.8311,
      });
    }
  }

  console.log(`Upserting ${attendanceRecords.length} attendance records for September 2026...`);

  const { data: upserted, error: upsertErr } = await supabase
    .from('attendance')
    .upsert(attendanceRecords, { onConflict: 'employee_id,date' })
    .select();

  if (upsertErr) {
    console.error('Error upserting attendance:', upsertErr);
  } else {
    console.log(`✅ Successfully added/updated ${upserted?.length} attendance records for September 2026!`);
  }
}

seedSeptemberAttendance().then(() => process.exit(0)).catch(console.error);
