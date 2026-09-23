import { Router } from 'express';
import { AdvanceSalaryController } from '../controllers/advance_salary.controller.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { branchScope } from '../middleware/branchScope.js';

const router = Router();

router.use(auth);
router.use(branchScope);

router.post('/', AdvanceSalaryController.create);
router.get('/', AdvanceSalaryController.list);
router.get('/summary', AdvanceSalaryController.getSummary);
router.get('/:id', AdvanceSalaryController.getById);
router.put('/:id/status', requireRole('owner'), AdvanceSalaryController.updateStatus);
router.delete('/:id', AdvanceSalaryController.remove);

export default router;
