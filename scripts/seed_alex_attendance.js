import { supabase } from '../src/db/supabase.js';

async function seedAlexAttendance() {
  console.log('🌱 Starting dummy daily attendance seed for Alex...');

  // 1. Fetch Alex
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, name, email')
    .ilike('name', '%alex%')
    .maybeSingle();

  if (userError || !user) {
    console.error('❌ Could not find employee Alex:', userError?.message || 'User not found');
    process.exit(1);
  }

  console.log(`👤 Found user: ${user.name} (${user.email}, ID: ${user.id})`);

  // 2. Fetch Branch
  const { data: branch } = await supabase
    .from('branches')
    .select('id, name, latitude, longitude')
    .limit(1)
    .single();

  const branchId = branch?.id || null;
  const lat = branch?.latitude || 21.218942;
  const lng = branch?.longitude || 72.869527;

  // 3. Define Daily Data for September 2026
  const dummyDays = [
    {
      date: '2026-09-01',
      clock_in: '2026-09-01T09:02:15.000Z',
      clock_out: '2026-09-01T18:05:30.000Z',
      status: 'present',
    },
    {
      date: '2026-09-02',
      clock_in: '2026-09-02T09:01:10.000Z',
      clock_out: '2026-09-02T18:10:00.000Z',
      status: 'present',
    },
    {
      date: '2026-09-03',
      clock_in: '2026-09-03T08:58:45.000Z',
      clock_out: '2026-09-03T18:02:15.000Z',
      status: 'present',
    },
    {
      date: '2026-09-04',
      clock_in: '2026-09-04T09:05:00.000Z',
      clock_out: '2026-09-04T18:08:20.000Z',
      status: 'present',
    },
    // 05, 06 Weekend
    {
      date: '2026-09-07',
      clock_in: '2026-09-07T09:00:30.000Z',
      clock_out: '2026-09-07T18:01:45.000Z',
      status: 'present',
    },
    {
      date: '2026-09-08',
      clock_in: '2026-09-08T09:42:00.000Z',
      clock_out: '2026-09-08T18:15:00.000Z',
      status: 'late',
      admin_notes: 'Late arrival by 12 mins beyond grace period',
    },
    {
      date: '2026-09-09',
      clock_in: '2026-09-09T08:55:00.000Z',
      clock_out: '2026-09-09T18:00:10.000Z',
      status: 'present',
    },
    {
      date: '2026-09-10',
      clock_in: '2026-09-10T09:03:20.000Z',
      clock_out: '2026-09-10T18:07:50.000Z',
      status: 'present',
    },
    {
      date: '2026-09-11',
      clock_in: null,
      clock_out: null,
      status: 'absent',
      admin_notes: 'Sick leave (unpaid absence)',
    },
    // 12, 13 Weekend
    {
      date: '2026-09-14',
      clock_in: '2026-09-14T08:59:10.000Z',
      clock_out: '2026-09-14T18:04:30.000Z',
      status: 'present',
    },
    {
      date: '2026-09-15',
      clock_in: '2026-09-15T09:02:00.000Z',
      clock_out: '2026-09-15T13:05:00.000Z',
      status: 'half_day',
      admin_notes: 'Half day approved by manager',
    },
    {
      date: '2026-09-16',
      clock_in: '2026-09-16T09:01:40.000Z',
      clock_out: '2026-09-16T18:12:00.000Z',
      status: 'present',
    },
    {
      date: '2026-09-17',
      clock_in: '2026-09-17T09:38:00.000Z',
      clock_out: '2026-09-17T18:05:00.000Z',
      status: 'late',
      admin_notes: 'Late arrival on 2026-09-17',
    },
    {
      date: '2026-09-18',
      clock_in: '2026-09-18T09:04:10.000Z',
      clock_out: '2026-09-18T18:06:20.000Z',
      status: 'present',
    },
    {
      date: '2026-09-19',
      clock_in: '2026-09-19T09:00:00.000Z',
      clock_out: '2026-09-19T18:00:00.000Z',
      status: 'present',
    },
  ];

  // 4. Upsert Attendance Records
  for (const item of dummyDays) {
    const record = {
      employee_id: user.id,
      branch_id: branchId,
      date: item.date,
      clock_in_time: item.clock_in,
      clock_in_lat: item.clock_in ? lat : null,
      clock_in_lng: item.clock_in ? lng : null,
      clock_out_time: item.clock_out,
      clock_out_lat: item.clock_out ? lat : null,
      clock_out_lng: item.clock_out ? lng : null,
      status: item.status,
      is_flagged: false,
      flag_reason: null,
      admin_notes: item.admin_notes || null,
    };

    const { error: upsertError } = await supabase
      .from('attendance')
      .upsert(record, { onConflict: 'employee_id, date' });

    if (upsertError) {
      console.error(`❌ Failed to insert ${item.date}:`, upsertError.message);
    } else {
      console.log(`✅ [${item.date}] Status: ${item.status.toUpperCase()} (${item.clock_in ? 'Clocked In' : 'No Punch'})`);
    }
  }

  console.log('\n🎉 Successfully populated dummy daily attendance records for Alex Smith!');
}

seedAlexAttendance();
