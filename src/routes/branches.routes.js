import { Router } from 'express';
import { BranchesController } from '../controllers/branches.controller.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { branchScope } from '../middleware/branchScope.js';

const router = Router();

router.use(auth);
router.use(branchScope);

router.post('/', requireRole('owner'), BranchesController.create);
router.get('/', requireRole('owner', 'branch_manager'), BranchesController.list);
router.get('/:id', requireRole('owner', 'branch_manager'), BranchesController.getById);
router.put('/:id', requireRole('owner'), BranchesController.update);
router.delete('/:id', requireRole('owner'), BranchesController.remove);

// QR Code endpoints for branches
router.get('/:id/qr', requireRole('owner', 'branch_manager'), BranchesController.getQR);
router.post('/:id/qr/regenerate', requireRole('owner', 'branch_manager'), BranchesController.regenerateQR);

export default router;
