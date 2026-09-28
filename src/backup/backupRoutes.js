import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../db/supabase.js';
import { runBackup } from './backupService.js';
import { getCurrentSchedule, updateSchedule } from './backupCron.js';

const router = Router();

/**
 * Universal Admin/Owner Auth Middleware for Backup System
 * Accepts either:
 * 1. App Owner JWT Token (via JWT_SECRET with role 'owner' or 'admin')
 * 2. Internal CRON_SECRET (via Authorization Bearer or x-cron-secret header)
 * 3. Supabase Auth Token
 */
export async function requireBackupAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const cronSecretHeader = req.headers['x-cron-secret'];
    const cronSecret = process.env.CRON_SECRET;

    // 1. Check CRON_SECRET header
    if (cronSecret && cronSecretHeader && cronSecretHeader === cronSecret) {
      req.user = { role: 'system', id: 'cron-runner' };
      return next();
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Access denied. Missing or invalid Authorization header. Expected Bearer <token>'
        }
      });
    }

    const token = authHeader.split(' ')[1];

    // 2. Check if Bearer token matches CRON_SECRET directly
    if (cronSecret && token === cronSecret) {
      req.user = { role: 'system', id: 'cron-runner' };
      return next();
    }

    // 3. Try App JWT Secret (Owner / Admin check)
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret) {
      try {
        const decoded = jwt.verify(token, jwtSecret);
        if (decoded && (decoded.role === 'owner' || decoded.role === 'admin')) {
          req.user = decoded;
          return next();
        }
        if (decoded && decoded.role) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: `Access denied. Role '${decoded.role}' is not authorized to trigger database backups.`
            }
          });
        }
      } catch (jwtErr) {
        // Not a standard app JWT or expired, try Supabase auth
      }
    }

    // 4. Try Supabase Auth Token
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user) {
        req.user = user;
        return next();
      }
    } catch (sbErr) {
      // Supabase auth failed
    }

    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired admin authorization token'
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_ERROR',
        message: err.message || 'Internal error during backup authentication'
      }
    });
  }
}

// Protect all backup routes
router.use(requireBackupAdmin);

/**
 * POST /api/hrm/backup/trigger or /api/backup/trigger
 * Manually triggers a database backup immediately
 */
router.post('/trigger', async (req, res) => {
  try {
    const result = await runBackup();
    return res.status(200).json({
      success: true,
      message: 'Backup completed successfully',
      filename: result.filename,
      driveFileId: result.driveFileId,
      timestamp: result.timestamp,
      prunedCount: result.prunedCount
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Backup failed',
      error: err.message || 'Unknown database backup error'
    });
  }
});

/**
 * GET /api/hrm/backup/schedule or /api/backup/schedule
 * Returns current cron schedule and description
 */
router.get('/schedule', (req, res) => {
  try {
    const scheduleInfo = getCurrentSchedule();
    return res.status(200).json({
      success: true,
      schedule: scheduleInfo.schedule,
      description: scheduleInfo.description,
      isActive: scheduleInfo.isActive
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to retrieve schedule'
    });
  }
});

/**
 * PUT /api/hrm/backup/schedule or /api/backup/schedule
 * Updates cron schedule dynamically without restarting the server
 * Body: { "schedule": "0 3 * * *" }
 */
router.put('/schedule', (req, res) => {
  try {
    const { schedule } = req.body;

    if (!schedule || typeof schedule !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Invalid cron expression: schedule string is required in body'
      });
    }

    const result = updateSchedule(schedule);

    return res.status(200).json({
      success: true,
      message: 'Schedule updated successfully',
      newSchedule: result.newSchedule,
      description: result.description
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Invalid cron expression'
    });
  }
});

export default router;
