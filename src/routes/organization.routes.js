import { Router } from 'express';
import { OrganizationController } from '../controllers/organization.controller.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

router.use(auth);

router.get('/settings/lunch-tracking', requireRole('owner', 'branch_manager'), OrganizationController.getLunchTrackingSettings);
router.put('/settings/lunch-tracking', requireRole('owner'), OrganizationController.updateLunchTrackingSettings);

export default router;
