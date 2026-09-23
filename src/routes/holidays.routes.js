import { Router } from 'express';
import { HolidaysController } from '../controllers/holidays.controller.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { branchScope } from '../middleware/branchScope.js';

const router = Router();

router.use(auth);
router.use(branchScope);

router.post('/', requireRole('owner', 'branch_manager'), HolidaysController.create);
router.get('/', HolidaysController.list); // All authenticated users
router.delete('/:id', requireRole('owner', 'branch_manager'), HolidaysController.remove);

export default router;
