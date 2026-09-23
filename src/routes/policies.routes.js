import { Router } from 'express';
import { PoliciesController } from '../controllers/policies.controller.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

router.use(auth);

router.post('/', requireRole('owner'), PoliciesController.create);
router.get('/', requireRole('owner', 'branch_manager', 'employee'), PoliciesController.list);
router.put('/:id', requireRole('owner'), PoliciesController.update);
router.delete('/:id', requireRole('owner'), PoliciesController.remove);

export default router;
