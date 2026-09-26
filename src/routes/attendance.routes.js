import { Router } from 'express';
import { AttendanceController } from '../controllers/attendance.controller.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { branchScope } from '../middleware/branchScope.js';

const router = Router();

// Internal Cron auto-flag (no JWT required, protected by CRON_SECRET)
router.post('/auto-flag', AttendanceController.autoFlag);

// Protected routes
router.use(auth);
router.use(branchScope);

// Employee actions
router.post('/clock-in', requireRole('employee', 'branch_manager'), AttendanceController.clockIn);
router.post('/clock-out', requireRole('employee', 'branch_manager'), AttendanceController.clockOut);
router.post('/lunch-start', requireRole('employee', 'branch_manager'), AttendanceController.startLunch);
router.post('/lunch-end', requireRole('employee', 'branch_manager'), AttendanceController.endLunch);
router.get('/my', requireRole('employee', 'branch_manager'), AttendanceController.myAttendance);

// Manager / Owner actions
router.get('/', requireRole('owner', 'branch_manager'), AttendanceController.list);
router.get('/daily-summary', requireRole('owner', 'branch_manager'), AttendanceController.getDailySummary);
router.get('/daily-roster', requireRole('owner', 'branch_manager'), AttendanceController.getDailyRoster);
router.get('/daily-status', requireRole('owner', 'branch_manager'), AttendanceController.getDailyStatus);
router.put('/:id/resolve', requireRole('owner', 'branch_manager'), AttendanceController.resolve);
router.post('/manual', requireRole('owner', 'branch_manager'), AttendanceController.manualPunch);

export default router;
