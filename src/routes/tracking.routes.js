import { Router } from 'express';
import { TrackingController } from '../controllers/tracking.controller.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { branchScope } from '../middleware/branchScope.js';

const router = Router();

router.use(auth);
router.use(branchScope);

// Employee mobile endpoint: sync batch of GPS points
router.post(
  '/batch',
  requireRole('employee', 'branch_manager', 'owner'),
  TrackingController.ingestBatch
);

// Owner / Branch Manager live location radar
router.get(
  '/live',
  requireRole('owner', 'branch_manager'),
  TrackingController.getLiveLocations
);

// Owner / Branch Manager historical route playback
router.get(
  '/history',
  requireRole('owner', 'branch_manager'),
  TrackingController.getEmployeeHistory
);

export default router;
