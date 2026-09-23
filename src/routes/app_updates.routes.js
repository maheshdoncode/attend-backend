import { Router } from 'express';
import { AppUpdatesController } from '../controllers/app_updates.controller.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

// Public / Authenticated version check
router.get('/check', AppUpdatesController.checkUpdate);

// Owner-only Release Management
router.post('/publish', auth, requireRole('owner'), AppUpdatesController.publishRelease);
router.get('/releases', auth, requireRole('owner'), AppUpdatesController.listReleases);
router.put('/releases/:id/rollout', auth, requireRole('owner'), AppUpdatesController.toggleRollout);
router.delete('/releases/:id', auth, requireRole('owner'), AppUpdatesController.deleteRelease);

export default router;
