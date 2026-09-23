import { Router } from 'express';
import { ReportsController } from '../controllers/reports.controller.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { branchScope } from '../middleware/branchScope.js';

const router = Router();

router.use(auth);
router.use(branchScope);

router.get('/attendance', requireRole('owner', 'branch_manager'), ReportsController.getAttendanceReport);
router.get('/payroll', requireRole('owner'), ReportsController.getPayrollReport);
router.get('/export', requireRole('owner', 'branch_manager'), ReportsController.exportReport);

export default router;
