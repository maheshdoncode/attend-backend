import { supabase } from '../src/db/supabase.js';

async function clearAttendanceAndPayroll() {
  console.log('🧹 Clearing all attendance entries and generated payroll payslips...');

  // 1. Delete all payroll records
  const { count: payrollCount, error: payrollError } = await supabase
    .from('payroll')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows

  if (payrollError) {
    console.error('❌ Error clearing payroll table:', payrollError.message);
  } else {
    console.log('✅ Successfully cleared all generated payslips from payroll table.');
  }

  // 2. Delete all attendance records
  const { count: attendanceCount, error: attendanceError } = await supabase
    .from('attendance')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows

  if (attendanceError) {
    console.error('❌ Error clearing attendance table:', attendanceError.message);
  } else {
    console.log('✅ Successfully cleared all attendance entry records for all employees.');
  }

  console.log('\n🎉 Database reset complete: Attendance and Payroll are now fresh and clean.');
}

clearAttendanceAndPayroll();
