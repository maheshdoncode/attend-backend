import { Router } from 'express';
import { PayrollController } from '../controllers/payroll.controller.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { branchScope } from '../middleware/branchScope.js';

const router = Router();

router.use(auth);
router.use(branchScope);

router.post('/generate', requireRole('owner'), PayrollController.generate);
router.get('/settings/visibility', requireRole('owner', 'branch_manager'), PayrollController.getGlobalVisibility);
router.put('/settings/visibility', requireRole('owner'), PayrollController.updateGlobalVisibility);
router.get('/', requireRole('owner', 'branch_manager', 'employee'), PayrollController.list);
router.put('/bulk-visibility', requireRole('owner'), PayrollController.updateBulkVisibility);
router.get('/:employee_id/:month/:year', requireRole('owner', 'branch_manager', 'employee'), PayrollController.getDetail);
router.put('/:id/finalize', requireRole('owner'), PayrollController.finalize);
router.put('/:id/visibility', requireRole('owner'), PayrollController.updateVisibility);
router.put('/:id', requireRole('owner'), PayrollController.updateDraft);
router.post('/:id/reset', requireRole('owner'), PayrollController.resetDraft);

export default router;
