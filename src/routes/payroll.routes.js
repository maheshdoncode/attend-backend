import { Router } from 'express';
import { PayrollController } from '../controllers/payroll.controller.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { branchScope } from '../middleware/branchScope.js';

const router = Router();

router.use(auth);
router.use(branchScope);

router.post('/generate', requireRole('owner'), PayrollController.generate);
router.get('/', requireRole('owner', 'branch_manager', 'employee'), PayrollController.list);
router.get('/:employee_id/:month/:year', requireRole('owner', 'branch_manager', 'employee'), PayrollController.getDetail);
router.put('/:id/finalize', requireRole('owner'), PayrollController.finalize);

export default router;
