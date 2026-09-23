import { Router } from 'express';
import { SchedulesController } from '../controllers/schedules.controller.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { branchScope } from '../middleware/branchScope.js';

const router = Router();

router.use(auth);
router.use(branchScope);

router.post('/', requireRole('owner'), SchedulesController.create);
router.get('/', requireRole('owner', 'branch_manager', 'employee'), SchedulesController.list);
router.put('/:id', requireRole('owner'), SchedulesController.update);
router.delete('/:id', requireRole('owner'), SchedulesController.remove);

export default router;
