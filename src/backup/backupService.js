import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { google } from 'googleapis';
import pg from 'pg';
import dns from 'dns';
const { Client } = pg;

// Enforce IPv4 DNS resolution first to prevent ENETUNREACH on platforms without IPv6 (Render/Heroku/Docker)
try {
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch (e) {}

export const MAX_BACKUP_RETENTION = 7;

/**
 * Ensures a directory exists synchronously
 */
export function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Initializes and returns an authenticated Google Drive client
 * Supports both:
 * 1. OAuth2 Refresh Token (Personal Google Drive with full 15GB storage)
 * 2. Service Account JSON (Google Workspace Shared Drives)
 */
export function getGoogleDriveClient() {
  const clientId = process.env.GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GDRIVE_REFRESH_TOKEN;

  // 1. If OAuth2 credentials are provided, use OAuth2Client (uses personal 15GB Drive storage)
  if (clientId && clientSecret && refreshToken) {
    const oauth2Client = new google.auth.OAuth2(
      clientId.trim(),
      clientSecret.trim(),
      'http://localhost:3333/oauth2callback'
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken.trim() });
    return google.drive({ version: 'v3', auth: oauth2Client });
  }

  // 2. Otherwise fall back to Service Account Key JSON
  const customPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const candidatePaths = [
    customPath ? path.resolve(process.cwd(), customPath) : null,
    path.resolve(process.cwd(), 'src/config/gdrive-service-account.json'),
    path.resolve(process.cwd(), 'config/gdrive-service-account.json'),
    path.resolve(process.cwd(), 'gdrive-service-account.json'),
  ].filter(Boolean);

  const resolvedKeyPath = candidatePaths.find((p) => fs.existsSync(p));

  if (!resolvedKeyPath) {
    throw new Error(
      `Google Drive credentials missing. Please configure GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN in .env or place your service account JSON in src/config/gdrive-service-account.json.`
    );
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: resolvedKeyPath,
    scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.file'],
  });

  return google.drive({ version: 'v3', auth });
}

/**
 * Formats a Date object to YYYY-MM-DD_HH-mm-ss
 */
export function getFormattedTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

/**
 * Formats a JavaScript value for SQL insertion
 */
export function formatSqlValue(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') {
    if (Number.isNaN(val)) return 'NULL';
    return String(val);
  }
  if (val instanceof Date) return `'${val.toISOString()}'`;
  if (Array.isArray(val)) {
    const jsonStr = JSON.stringify(val).replace(/'/g, "''");
    return `'${jsonStr}'::jsonb`;
  }
  if (typeof val === 'object') {
    return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

function sanitizeDbUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim();
  if (url.includes('=') && (url.toUpperCase().startsWith('SUPABASE_DB_URL=') || url.toUpperCase().startsWith('DATABASE_URL='))) {
    url = url.substring(url.indexOf('=') + 1).trim();
  }
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1).trim();
  }
  return url;
}

/**
 * Pure Node.js / PostgreSQL Table & Data Dumper (Optimized query-backend engine)
 */
export async function executeNodePgDump(rawDbUrl, outputPath) {
  const dbUrl = sanitizeDbUrl(rawDbUrl);
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  console.log(`[DATABASE BACKUP] Connecting to PostgreSQL host: ${client.connectionParameters.host}:${client.connectionParameters.port} (database: ${client.connectionParameters.database})...`);
  await client.connect();

  try {
    const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf8' });

    // Write SQL Header
    writeStream.write(`-- =====================================================================\n`);
    writeStream.write(`-- Attendy HRMS Database Backup (Automated Node.js PG Engine)\n`);
    writeStream.write(`-- Timestamp: ${new Date().toISOString()}\n`);
    writeStream.write(`-- =====================================================================\n\n`);
    writeStream.write(`SET client_encoding = 'UTF8';\n`);
    writeStream.write(`SET standard_conforming_strings = on;\n`);
    writeStream.write(`SET check_function_bodies = false;\n`);
    writeStream.write(`SET client_min_messages = warning;\n\n`);

    // 1. Extensions
    writeStream.write(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";\n`);
    writeStream.write(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";\n\n`);

    writeStream.write(`BEGIN;\n\n`);
    writeStream.write(`-- Temporarily bypass FK check order during restore\n`);
    writeStream.write(`SET session_replication_role = 'replica';\n\n`);

    // 2. Fetch all public tables
    const tableRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    const allTables = tableRes.rows.map((r) => r.table_name);

    // Priority ordering for clean foreign key hierarchy
    const priorityOrder = [
      'branches',
      'users',
      'employee_profiles',
      'work_schedules',
      'work_schedule_shifts',
      'employee_shift_assignments',
      'employee_schedule_overrides',
      'branch_employee_assignments',
      'branch_managers',
      'attendance',
      'employee_live_locations',
      'employee_route_history',
      'leaves',
      'holidays',
      'payroll',
      'payroll_daily_records',
      'advance_salaries',
      'app_releases',
      'organization_settings',
    ];

    const tables = [
      ...priorityOrder.filter((t) => allTables.includes(t)),
      ...allTables.filter((t) => !priorityOrder.includes(t)),
    ];

    for (const tableName of tables) {
      writeStream.write(`-- ---------------------------------------------------------------------\n`);
      writeStream.write(`-- Table: public."${tableName}"\n`);
      writeStream.write(`-- ---------------------------------------------------------------------\n`);

      // Fetch columns
      const colRes = await client.query(`
        SELECT column_name, data_type, udt_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
      `, [tableName]);

      const columns = colRes.rows;
      if (columns.length === 0) continue;

      // Generate CREATE TABLE statement
      const colDefs = columns.map((c) => {
        let colType = c.data_type.toUpperCase();
        if (c.data_type === 'ARRAY') {
          colType = `${(c.udt_name.startsWith('_') ? c.udt_name.substring(1) : c.udt_name).toUpperCase()}[]`;
        } else if (c.data_type === 'USER-DEFINED') {
          colType = `"${c.udt_name}"`;
        }
        let def = `  "${c.column_name}" ${colType}`;
        if (c.column_default) def += ` DEFAULT ${c.column_default}`;
        if (c.is_nullable === 'NO') def += ` NOT NULL`;
        return def;
      });

      writeStream.write(`CREATE TABLE IF NOT EXISTS public."${tableName}" (\n${colDefs.join(',\n')}\n);\n\n`);

      // Fetch all rows
      const rowRes = await client.query(`SELECT * FROM public."${tableName}"`);
      const rows = rowRes.rows;

      if (rows.length > 0) {
        const colNames = columns.map((c) => `"${c.column_name}"`).join(', ');

        // Batch rows into multi-row INSERTs (up to 50 rows per statement)
        const BATCH_SIZE = 50;
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          const valueRows = batch
            .map((row) => {
              const values = columns.map((c) => formatSqlValue(row[c.column_name])).join(', ');
              return `  (${values})`;
            })
            .join(',\n');

          writeStream.write(`INSERT INTO public."${tableName}" (${colNames}) VALUES\n${valueRows}\nON CONFLICT DO NOTHING;\n\n`);
        }
      }
    }

    writeStream.write(`-- Re-enable standard constraint checking\n`);
    writeStream.write(`SET session_replication_role = 'origin';\n\n`);
    writeStream.write(`COMMIT;\n\n`);
    writeStream.write(`-- Backup completed successfully at ${new Date().toISOString()}\n`);

    await new Promise((resolve, reject) => {
      writeStream.end(resolve);
      writeStream.on('error', reject);
    });

    await client.end();
    return outputPath;
  } catch (err) {
    await client.end().catch(() => {});
    throw err;
  }
}

/**
 * Executes pg_dump to produce a SQL backup file, or falls back to Node pg dumper
 */
export function executeDump(dbUrl, outputPath) {
  return new Promise((resolve, reject) => {
    // 1. Try native pg_dump if present
    const command = `pg_dump "${dbUrl}" --no-owner --no-acl -F p -f "${outputPath}"`;

    exec(command, { maxBuffer: 1024 * 1024 * 100 }, async (error, stdout, stderr) => {
      if (!error && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        console.log('[DATABASE BACKUP] Generated backup using native pg_dump CLI');
        return resolve(outputPath);
      }

      // If pg_dump command not found or failed, use Node.js direct dumper
      console.log('[DATABASE BACKUP] pg_dump CLI unavailable, executing pure Node.js PostgreSQL backup engine...');
      try {
        await executeNodePgDump(dbUrl, outputPath);
        console.log('[DATABASE BACKUP] Generated backup using Node.js PostgreSQL engine');
        resolve(outputPath);
      } catch (nodeErr) {
        reject(new Error(`Database backup failed: ${nodeErr.message || stderr || error?.message}`));
      }
    });
  });
}

/**
 * Uploads a file stream to Google Drive inside a target folder
 */
export async function uploadFileToDrive(drive, filePath, filename, folderId) {
  const fileMetadata = {
    name: filename,
    parents: folderId ? [folderId.trim()] : [],
  };

  const media = {
    mimeType: 'application/sql',
    body: fs.createReadStream(filePath),
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id, name, size, createdTime',
  });

  return response.data;
}

/**
 * Prunes backups in Google Drive folder, keeping only the 7 most recent
 */
export async function pruneOldDriveBackups(drive, folderId, keepCount = MAX_BACKUP_RETENTION) {
  try {
    if (!folderId) return 0;

    const listResponse = await drive.files.list({
      q: `'${folderId.trim()}' in parents and trashed = false`,
      orderBy: 'createdTime desc',
      fields: 'files(id, name, createdTime)',
      pageSize: 50,
    });

    const files = listResponse.data.files || [];
    let deletedCount = 0;

    if (files.length > keepCount) {
      const filesToDelete = files.slice(keepCount);
      for (const file of filesToDelete) {
        try {
          await drive.files.delete({ fileId: file.id });
          deletedCount++;
          console.log(`[BACKUP PRUNE] Deleted old Drive backup: ${file.name} (ID: ${file.id})`);
        } catch (delErr) {
          console.warn(`[BACKUP PRUNE] Failed to delete old backup ${file.id}: ${delErr.message}`);
        }
      }
    }
    return deletedCount;
  } catch (err) {
    console.warn(`[BACKUP PRUNE] Warning during retention cleanup: ${err.message}`);
    return 0;
  }
}

/**
 * Resolves or auto-creates the backups folder in Google Drive
 */
export async function resolveBackupFolder(drive, targetFolderId) {
  if (targetFolderId) {
    try {
      const res = await drive.files.get({ fileId: targetFolderId.trim(), fields: 'id, name, trashed' });
      if (res.data && !res.data.trashed) {
        return res.data.id;
      }
    } catch (err) {
      console.warn(`[BACKUP FOLDER] Specified folder ID (${targetFolderId}) not accessible (${err.message}). Resolving 'backups' folder...`);
    }
  }

  try {
    const list = await drive.files.list({
      q: "name = 'backups' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      fields: 'files(id, name)',
      pageSize: 1,
    });
    if (list.data.files && list.data.files.length > 0) {
      return list.data.files[0].id;
    }

    const created = await drive.files.create({
      requestBody: {
        name: 'backups',
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });
    return created.data.id;
  } catch (createErr) {
    console.warn('[BACKUP FOLDER] Could not search/create backups folder, uploading to root:', createErr.message);
    return null;
  }
}

/**
 * Main Backup Orchestration Function
 */
export async function runBackup() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error('SUPABASE_DB_URL is not set in environment variables');
  }

  const rawFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  const backupDir = path.resolve(process.cwd(), process.env.BACKUP_DIR || './backups');
  ensureDirectoryExists(backupDir);

  const timestampStr = getFormattedTimestamp();
  const filename = `backup_${timestampStr}.sql`;
  const localFilePath = path.join(backupDir, filename);

  console.log(`[DATABASE BACKUP] Starting backup process: ${filename}`);

  let driveFileId = null;
  let prunedCount = 0;

  try {
    // 1. Run database dump (auto-detects pg_dump CLI or pure Node.js dumper)
    await executeDump(dbUrl, localFilePath);

    // Verify created file size
    const stats = fs.statSync(localFilePath);
    if (stats.size === 0) {
      throw new Error('Database dump produced an empty backup file (0 bytes)');
    }

    console.log(`[DATABASE BACKUP] Backup file created (${stats.size} bytes): ${localFilePath}`);

    // 2. Initialize Google Drive client
    const drive = getGoogleDriveClient();

    // Resolve folder
    const folderId = await resolveBackupFolder(drive, rawFolderId);

    // 3. Upload to Google Drive
    const driveFile = await uploadFileToDrive(drive, localFilePath, filename, folderId);
    driveFileId = driveFile.id;
    console.log(`[DATABASE BACKUP] Uploaded to Google Drive successfully! File ID: ${driveFileId}`);

    // 4. Prune old backups (Keep last 7)
    if (folderId) {
      prunedCount = await pruneOldDriveBackups(drive, folderId, MAX_BACKUP_RETENTION);
    }

    // 5. Clean up local temporary file after successful Drive upload
    try {
      if (fs.existsSync(localFilePath)) {
        fs.unlinkSync(localFilePath);
        console.log(`[DATABASE BACKUP] Cleaned up temporary local file: ${filename}`);
      }
    } catch (cleanupErr) {
      console.warn(`[DATABASE BACKUP] Could not remove temp file: ${cleanupErr.message}`);
    }

    return {
      success: true,
      filename,
      driveFileId,
      timestamp: new Date().toISOString(),
      prunedCount,
    };
  } catch (err) {
    console.error(`[DATABASE BACKUP FAILED]: ${err.message}`, err);
    if (fs.existsSync(localFilePath)) {
      console.log(`[DATABASE BACKUP] Local fallback file preserved at: ${localFilePath}`);
    }
    throw err;
  }
}
