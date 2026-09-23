import { supabase } from '../src/db/supabase.js';

async function seedAugust2026() {
  console.log('🌱 Seeding August 2026 attendance data for Mahesh and Alex...');

  const employeeIds = [
    '64d7d71f-2300-4dde-a70f-b6cc93cad373', // Mahesh
    '7607e95f-5905-4dfe-9c56-4b477019a64e', // Alex Smith
  ];

  const branchId = '5c21f7b8-0436-41e7-8845-17a3bd0d0735';
  const lat = 21.218942;
  const lng = 72.869527;

  // August 2026 has 31 days (2026-08-01 to 2026-08-31)
  const daysInAugust = 31;

  for (const empId of employeeIds) {
    const { data: user } = await supabase
      .from('users')
      .select('name, role')
      .eq('id', empId)
      .single();

    console.log(`\n👤 Seeding records for ${user?.name || empId} (${user?.role})...`);

    const records = [];

    for (let day = 1; day <= daysInAugust; day++) {
      const dateStr = `2026-08-${String(day).padStart(2, '0')}`;
      const dateObj = new Date(2026, 7, day); // Month index 7 = August
      const dayOfWeek = dateObj.getDay(); // 0 = Sunday

      // Sundays are off (no punch)
      if (dayOfWeek === 0) {
        continue;
      }

      let status = 'present';
      let clockInTime = `${dateStr}T09:00:00.000Z`;
      let clockOutTime = `${dateStr}T18:00:00.000Z`;
      let adminNotes = null;

      if (empId === '64d7d71f-2300-4dde-a70f-b6cc93cad373') {
        // Mahesh patterns
        if (day === 10) {
          status = 'late';
          clockInTime = `${dateStr}T09:35:00.000Z`;
          adminNotes = 'Late arrival (traffic)';
        } else if (day === 21) {
          status = 'half_day';
          clockOutTime = `${dateStr}T13:00:00.000Z`;
          adminNotes = 'Personal leave (half day)';
        } else if (day === 28) {
          status = 'absent';
          clockInTime = null;
          clockOutTime = null;
          adminNotes = 'Unplanned absence';
        } else {
          // Slight jitter for realism
          const randomMinIn = Math.floor(Math.random() * 6);
          const randomMinOut = Math.floor(Math.random() * 12);
          clockInTime = `${dateStr}T09:0${randomMinIn}:15.000Z`;
          clockOutTime = `${dateStr}T18:${String(randomMinOut).padStart(2, '0')}:30.000Z`;
        }
      } else {
        // Alex Smith patterns
        if (day === 7 || day === 19) {
          status = 'late';
          clockInTime = `${dateStr}T09:42:00.000Z`;
          adminNotes = 'Late check-in';
        } else if (day === 14) {
          status = 'half_day';
          clockOutTime = `${dateStr}T13:05:00.000Z`;
          adminNotes = 'Half day afternoon leave';
        } else if (day === 11 || day === 25) {
          status = 'absent';
          clockInTime = null;
          clockOutTime = null;
          adminNotes = 'Medical / personal absence';
        } else {
          const randomMinIn = Math.floor(Math.random() * 8);
          const randomMinOut = Math.floor(Math.random() * 10);
          clockInTime = `${dateStr}T09:0${randomMinIn}:20.000Z`;
          clockOutTime = `${dateStr}T18:${String(randomMinOut).padStart(2, '0')}:45.000Z`;
        }
      }

      records.push({
        employee_id: empId,
        branch_id: branchId,
        date: dateStr,
        clock_in_time: clockInTime,
        clock_in_lat: clockInTime ? lat : null,
        clock_in_lng: clockInTime ? lng : null,
        clock_out_time: clockOutTime,
        clock_out_lat: clockOutTime ? lat : null,
        clock_out_lng: clockOutTime ? lng : null,
        status,
        is_flagged: false,
        flag_reason: null,
        admin_notes: adminNotes,
      });
    }

    // Upsert records
    for (const r of records) {
      const { error } = await supabase
        .from('attendance')
        .upsert(r, { onConflict: 'employee_id, date' });

      if (error) {
        console.error(`❌ Error on ${r.date}:`, error.message);
      }
    }

    console.log(`✅ Successfully seeded ${records.length} days of attendance for ${user?.name || empId} in August 2026.`);
  }

  console.log('\n🎉 Finished seeding August 2026 dummy data!');
}

seedAugust2026();
