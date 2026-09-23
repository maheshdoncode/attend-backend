import { Router } from 'express';
import { EmployeesController } from '../controllers/employees.controller.js';
import { SchedulesController } from '../controllers/schedules.controller.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { branchScope } from '../middleware/branchScope.js';

const router = Router();

// Apply auth and branchScope for all employee routes
router.use(auth);
router.use(branchScope);

router.post('/', requireRole('owner', 'branch_manager'), EmployeesController.create);
router.get('/', requireRole('owner', 'branch_manager'), EmployeesController.list);
router.get('/:id', requireRole('owner', 'branch_manager'), EmployeesController.getById);
router.put('/:id', requireRole('owner', 'branch_manager'), EmployeesController.update);
router.delete('/:id', requireRole('owner'), EmployeesController.remove);

// Password & Status management (Owner only)
router.get('/:id/password', requireRole('owner'), EmployeesController.getPassword);
router.put('/:id/password', requireRole('owner'), EmployeesController.changePassword);
router.put('/:id/status', requireRole('owner'), EmployeesController.updateStatus);

// Employee schedule override routes
router.post('/:id/schedule', requireRole('owner', 'branch_manager'), SchedulesController.assignEmployeeSchedule);
router.delete('/:id/schedule', requireRole('owner'), SchedulesController.removeEmployeeScheduleOverride);

export default router;
