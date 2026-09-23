import { supabase } from '../src/db/supabase.js';

const EMP_IDS = [
  '64d7d71f-2300-4dde-a70f-b6cc93cad373',
  '7607e95f-5905-4dfe-9c56-4b477019a64e',
];

async function fixSeptemberAttendance() {
  console.log('Fixing September 2026 attendance with accurate IST timezone (+05:30) timestamps...');

  const { data: branches } = await supabase.from('branches').select('id, name, latitude, longitude').limit(1);
  const defaultBranch = branches?.[0];

  const year = 2026;
  const month = 9; // September
  const daysInMonth = 30;

  const attendanceRecords = [];

  for (const empId of EMP_IDS) {
    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(Date.UTC(year, month - 1, day));
      const dayOfWeek = dateObj.getUTCDay(); // 0 is Sunday
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      // Sundays are off (no attendance record)
      if (dayOfWeek === 0) {
        continue;
      }

      let status = 'present';
      let clockInTimeStr = '08:52:00';
      let clockOutTimeStr = '18:05:00';

      // Realistic distribution:
      if (day === 4 || day === 15) {
        // Late arrival (9:25 AM & 9:35 AM > 9:10 AM threshold)
        status = 'late';
        clockInTimeStr = day === 4 ? '09:25:00' : '09:35:00';
        clockOutTimeStr = '18:10:00';
      } else if (day === 9) {
        // Half day
        status = 'half_day';
        clockInTimeStr = '08:50:00';
        clockOutTimeStr = '13:30:00';
      } else if (day === 22) {
        // Late arrival (9:20 AM)
        status = 'late';
        clockInTimeStr = '09:20:00';
        clockOutTimeStr = '18:05:00';
      } else {
        // On-time present (between 8:45 AM and 8:58 AM)
        const minute = 48 + ((day * 3) % 11);
        const second = (day * 7) % 60;
        clockInTimeStr = `08:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;

        const outMinute = 2 + ((day * 4) % 18);
        const outSecond = (day * 11) % 60;
        clockOutTimeStr = `18:${String(outMinute).padStart(2, '0')}:${String(outSecond).padStart(2, '0')}`;
      }

      // Store in IST (+05:30) so when parsed on device it shows the exact intended local time (08:52 AM, 09:25 AM, 06:05 PM)
      const clockInIso = `${dateStr}T${clockInTimeStr}+05:30`;
      const clockOutIso = `${dateStr}T${clockOutTimeStr}+05:30`;

      attendanceRecords.push({
        employee_id: empId,
        branch_id: defaultBranch?.id,
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

  const { data: upserted, error } = await supabase
    .from('attendance')
    .upsert(attendanceRecords, { onConflict: 'employee_id,date' })
    .select();

  if (error) {
    console.error('Error updating records:', error);
  } else {
    console.log(`✅ Successfully corrected ${upserted?.length} attendance records with proper IST timestamps & statuses!`);
  }
}

fixSeptemberAttendance().then(() => process.exit(0)).catch(console.error);
