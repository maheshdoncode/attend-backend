import cron from 'node-cron';
import cronstrue from 'cronstrue';
import { runBackup } from './backupService.js';

let currentJob = null;
let currentSchedule = process.env.DEFAULT_CRON_SCHEDULE || '0 2 * * *';
let isBackupRunning = false;

/**
 * Returns a human-readable description of a cron expression
 */
export function getCronDescription(cronExp) {
  try {
    return cronstrue.toString(cronExp, { throwExceptionOnParseError: false });
  } catch (e) {
    return 'Custom scheduled interval';
  }
}

/**
 * Core handler executed on each scheduled cron tick
 */
export async function handleScheduledBackup() {
  if (isBackupRunning) {
    console.warn('[BACKUP CRON] Previous backup is still running, skipping current cycle');
    return;
  }

  isBackupRunning = true;
  console.log(`[BACKUP CRON] Triggered scheduled backup at ${new Date().toISOString()}`);

  try {
    const result = await runBackup();
    console.log(
      `[BACKUP CRON] Scheduled backup finished successfully: ${result.filename} (Drive ID: ${result.driveFileId})`
    );
  } catch (err) {
    console.error(`[BACKUP CRON] Scheduled backup job failed: ${err.message}`);
  } finally {
    isBackupRunning = false;
  }
}

/**
 * Initializes the backup cron manager on application startup
 */
export function initBackupCron() {
  const initialSchedule = process.env.DEFAULT_CRON_SCHEDULE || '0 2 * * *';

  if (!cron.validate(initialSchedule)) {
    console.error(
      `[BACKUP CRON] Invalid DEFAULT_CRON_SCHEDULE '${initialSchedule}'. Fallback to '0 2 * * *' (Daily at 2:00 AM)`
    );
    currentSchedule = '0 2 * * *';
  } else {
    currentSchedule = initialSchedule;
  }

  if (currentJob) {
    currentJob.stop();
  }

  currentJob = cron.schedule(currentSchedule, handleScheduledBackup);
  console.log(
    `[BACKUP CRON] Backup cron initialized with schedule: [${currentSchedule}] (${getCronDescription(currentSchedule)})`
  );
}

/**
 * Returns the active cron schedule information
 */
export function getCurrentSchedule() {
  return {
    schedule: currentSchedule,
    description: getCronDescription(currentSchedule),
    isActive: Boolean(currentJob)
  };
}

/**
 * Dynamically updates the cron schedule without restarting the server
 * @param {string} newCronExpression
 */
export function updateSchedule(newCronExpression) {
  if (!newCronExpression || typeof newCronExpression !== 'string') {
    throw new Error('Cron expression string is required');
  }

  const cleanExp = newCronExpression.trim();

  if (!cron.validate(cleanExp)) {
    throw new Error(`Invalid cron expression '${cleanExp}'. Please provide a standard 5-part cron format (e.g. '0 3 * * *')`);
  }

  // Stop previous job
  if (currentJob) {
    currentJob.stop();
  }

  // Assign and schedule new job
  currentSchedule = cleanExp;
  currentJob = cron.schedule(currentSchedule, handleScheduledBackup);

  const description = getCronDescription(currentSchedule);
  console.log(`[BACKUP CRON] Cron schedule dynamically updated to: [${currentSchedule}] (${description})`);

  return {
    success: true,
    message: 'Schedule updated successfully',
    newSchedule: currentSchedule,
    description
  };
}
