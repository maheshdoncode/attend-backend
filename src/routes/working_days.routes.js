import { Router } from 'express';
import { WorkingDaysController } from '../controllers/working_days.controller.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { branchScope } from '../middleware/branchScope.js';

const router = Router();

router.use(auth);
router.use(branchScope);

router.post('/', requireRole('owner', 'branch_manager', 'admin'), WorkingDaysController.create);
router.get('/', requireRole('owner', 'branch_manager', 'admin', 'employee'), WorkingDaysController.list);
router.delete('/:id', requireRole('owner', 'branch_manager', 'admin'), WorkingDaysController.remove);

export default router;
