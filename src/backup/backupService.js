import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { google } from 'googleapis';
import pg from 'pg';
const { Client } = pg;

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
    path.resolve(process.cwd(), 'gdrive-service-account.json')
  ].filter(Boolean);

  const resolvedKeyPath = candidatePaths.find((p) => fs.existsSync(p));

  if (!resolvedKeyPath) {
    throw new Error(
      `Google Drive credentials missing. Please configure GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN in .env or place your service account JSON in src/config/gdrive-service-account.json.`
    );
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: resolvedKeyPath,
    scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.file']
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
    // Format PostgreSQL array literal or JSON
    const jsonStr = JSON.stringify(val).replace(/'/g, "''");
    return `'${jsonStr}'::jsonb`;
  }
  if (typeof val === 'object') {
    return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  }
  // Escape single quotes for strings / text / UUIDs
  return `'${String(val).replace(/'/g, "''")}'`;
}

/**
 * Maps Postgres information_schema data_type and udt_name to full SQL column type
 */
function getColumnDataTypeSql(col) {
  const { data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale } = col;

  if (data_type === 'ARRAY') {
    const innerType = udt_name.startsWith('_') ? udt_name.substring(1) : udt_name;
    return `${innerType.toUpperCase()}[]`;
  }

  if (data_type === 'character varying') {
    return character_maximum_length ? `VARCHAR(${character_maximum_length})` : 'VARCHAR';
  }

  if (data_type === 'character') {
    return character_maximum_length ? `CHAR(${character_maximum_length})` : 'CHAR';
  }

  if (data_type === 'numeric') {
    if (numeric_precision && numeric_scale !== null && numeric_scale !== undefined) {
      return `NUMERIC(${numeric_precision}, ${numeric_scale})`;
    }
    if (numeric_precision) {
      return `NUMERIC(${numeric_precision})`;
    }
    return 'NUMERIC';
  }

  if (data_type === 'USER-DEFINED') {
    return `"${udt_name}"`;
  }

  return data_type.toUpperCase();
}

function sanitizeDbUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim();
  // Strip leading key name if accidentally pasted into value box (e.g. SUPABASE_DB_URL=postgresql://...)
  if (url.includes('=') && (url.toUpperCase().startsWith('SUPABASE_DB_URL=') || url.toUpperCase().startsWith('DATABASE_URL='))) {
    url = url.substring(url.indexOf('=') + 1).trim();
  }
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1).trim();
  }
  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    throw new Error(
      `SUPABASE_DB_URL must be a valid PostgreSQL connection URI starting with 'postgresql://'. Received: "${url.substring(0, 20)}..."`
    );
  }
  return url;
}

/**
 * Pure Node.js / PostgreSQL Table & Data Dumper
 * Fallback engine when pg_dump CLI is not installed on the system
 * Produces clean, runnable SQL that executes flawlessly on empty databases.
 */
export async function executeNodePgDump(rawDbUrl, outputPath) {
  const dbUrl = sanitizeDbUrl(rawDbUrl);
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
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
    writeStream.write(`-- 1. PostgreSQL Extensions\n`);
    writeStream.write(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";\n`);
    writeStream.write(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";\n\n`);

    // 2. Custom Types (Enums)
    try {
      const enumRes = await client.query(`
        SELECT t.typname, string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) AS enum_values
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
        GROUP BY t.typname;
      `);

      if (enumRes.rows.length > 0) {
        writeStream.write(`-- 2. Custom Types & Enums\n`);
        for (const row of enumRes.rows) {
          writeStream.write(`DO $$ BEGIN\n`);
          writeStream.write(`  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${row.typname}') THEN\n`);
          writeStream.write(`    CREATE TYPE "${row.typname}" AS ENUM (${row.enum_values});\n`);
          writeStream.write(`  END IF;\n`);
          writeStream.write(`END $$;\n\n`);
        }
      }
    } catch (enumErr) {
      console.warn('[BACKUP DUMP] Warning reading custom enum types:', enumErr.message);
    }

    // 3. Helper Functions & Triggers
    writeStream.write(`-- 3. Utility Functions\n`);
    writeStream.write(`CREATE OR REPLACE FUNCTION update_updated_at_column()\n`);
    writeStream.write(`RETURNS TRIGGER AS $$\n`);
    writeStream.write(`BEGIN\n`);
    writeStream.write(`    NEW.updated_at = NOW();\n`);
    writeStream.write(`    RETURN NEW;\n`);
    writeStream.write(`END;\n`);
    writeStream.write(`$$ LANGUAGE plpgsql;\n\n`);

    writeStream.write(`BEGIN;\n\n`);
    writeStream.write(`-- Temporarily bypass FK / trigger checks during restore\n`);
    writeStream.write(`SET session_replication_role = 'replica';\n\n`);

    // 4. Fetch all public tables
    const tableRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    const allTables = tableRes.rows.map((r) => r.table_name);

    // Topological/Priority Order for Attendy Schema
    const priorityOrder = [
      'users',
      'branches',
      'work_schedules',
      'deduction_policies',
      'organization_settings',
      'employee_profiles',
      'branch_managers',
      'branch_employee_assignments',
      'employee_schedule_overrides',
      'holidays',
      'attendance',
      'payroll',
      'working_days_overrides',
      'advance_salaries',
      'app_releases'
    ];

    const tables = [
      ...priorityOrder.filter((t) => allTables.includes(t)),
      ...allTables.filter((t) => !priorityOrder.includes(t))
    ];

    // Collect constraints and indexes to add after table structures
    const allIndexes = [];

    for (const tableName of tables) {
      writeStream.write(`-- ---------------------------------------------------------------------\n`);
      writeStream.write(`-- Table: public."${tableName}"\n`);
      writeStream.write(`-- ---------------------------------------------------------------------\n`);

      // Fetch columns
      const colRes = await client.query(`
        SELECT column_name, data_type, udt_name, is_nullable, column_default,
               character_maximum_length, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
      `, [tableName]);

      const columns = colRes.rows;
      if (columns.length === 0) continue;

      // Generate column definitions
      const colDefs = columns.map((c) => {
        let typeStr = getColumnDataTypeSql(c);
        let def = `  "${c.column_name}" ${typeStr}`;
        if (c.column_default) {
          def += ` DEFAULT ${c.column_default}`;
        }
        if (c.is_nullable === 'NO') {
          def += ` NOT NULL`;
        }
        return def;
      });

      // Fetch Primary Key
      try {
        const pkRes = await client.query(`
          SELECT kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = 'public'
            AND tc.table_name = $1
          ORDER BY kcu.ordinal_position;
        `, [tableName]);

        if (pkRes.rows.length > 0) {
          const pkCols = pkRes.rows.map((r) => `"${r.column_name}"`).join(', ');
          colDefs.push(`  PRIMARY KEY (${pkCols})`);
        }
      } catch (pkErr) {
        console.warn(`[BACKUP DUMP] Could not fetch PK for ${tableName}:`, pkErr.message);
      }

      writeStream.write(`CREATE TABLE IF NOT EXISTS public."${tableName}" (\n${colDefs.join(',\n')}\n);\n\n`);

      // Fetch indexes on table
      try {
        const idxRes = await client.query(`
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = $1
            AND indexname NOT LIKE '%_pkey';
        `, [tableName]);

        for (const idx of idxRes.rows) {
          allIndexes.push(idx.indexdef);
        }
      } catch (idxErr) {
        console.warn(`[BACKUP DUMP] Could not fetch indexes for ${tableName}:`, idxErr.message);
      }

      // Fetch rows for data insertion
      const rowRes = await client.query(`SELECT * FROM public."${tableName}"`);
      const rows = rowRes.rows;

      if (rows.length > 0) {
        const colNames = columns.map((c) => `"${c.column_name}"`).join(', ');
        const BATCH_SIZE = 50;

        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          const valueRows = batch.map((row) => {
            const values = columns.map((c) => formatSqlValue(row[c.column_name])).join(', ');
            return `  (${values})`;
          }).join(',\n');

          writeStream.write(`INSERT INTO public."${tableName}" (${colNames}) VALUES\n${valueRows}\nON CONFLICT DO NOTHING;\n\n`);
        }
      }
    }

    // Add Indexes at the end
    if (allIndexes.length > 0) {
      writeStream.write(`-- ---------------------------------------------------------------------\n`);
      writeStream.write(`-- Performance Indexes\n`);
      writeStream.write(`-- ---------------------------------------------------------------------\n`);
      for (const idxDef of allIndexes) {
        // Ensure CREATE INDEX IF NOT EXISTS syntax
        const safeIdxDef = idxDef.replace(/^CREATE UNIQUE INDEX /i, 'CREATE UNIQUE INDEX IF NOT EXISTS ')
                                 .replace(/^CREATE INDEX /i, 'CREATE INDEX IF NOT EXISTS ');
        writeStream.write(`${safeIdxDef};\n`);
      }
      writeStream.write(`\n`);
    }

    writeStream.write(`-- Re-enable standard constraint checking\n`);
    writeStream.write(`SET session_replication_role = 'origin';\n\n`);
    writeStream.write(`COMMIT;\n\n`);
    writeStream.write(`-- =====================================================================\n`);
    writeStream.write(`-- Backup generated successfully at ${new Date().toISOString()}\n`);
    writeStream.write(`-- =====================================================================\n`);

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
 * Executes pg_dump to produce a SQL backup file, or falls back to Node.js pg dumper
 */
export function executeDump(rawDbUrl, outputPath) {
  const dbUrl = sanitizeDbUrl(rawDbUrl);
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
    parents: folderId ? [folderId.trim()] : []
  };

  const media = {
    mimeType: 'application/sql',
    body: fs.createReadStream(filePath)
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id, name, size, createdTime'
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
      pageSize: 50
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
 * Main Backup Orchestration Function
 * - Generates filename: backup_YYYY-MM-DD_HH-mm-ss.sql
 * - Executes database dump (pg_dump or Node PostgreSQL engine)
 * - Saves .sql file to BACKUP_DIR
 * - Uploads file to Google Drive under GOOGLE_DRIVE_FOLDER_ID
 * - Deletes any files beyond the 7 most recent in Drive
 * - Returns { success: true, filename, driveFileId, timestamp, prunedCount }
 */
export async function runBackup() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error('SUPABASE_DB_URL is not set in environment variables');
  }

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID is not set in environment variables');
  }

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

    // 3. Upload to Google Drive
    const driveFile = await uploadFileToDrive(drive, localFilePath, filename, folderId);
    driveFileId = driveFile.id;
    console.log(`[DATABASE BACKUP] Uploaded to Google Drive successfully! File ID: ${driveFileId}`);

    // 4. Prune old backups (Keep last 7)
    prunedCount = await pruneOldDriveBackups(drive, folderId, MAX_BACKUP_RETENTION);

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
      prunedCount
    };
  } catch (err) {
    console.error(`[DATABASE BACKUP FAILED]: ${err.message}`, err);
    // Keep local file as fallback if Google Drive upload failed
    if (fs.existsSync(localFilePath)) {
      console.log(`[DATABASE BACKUP] Local fallback file preserved at: ${localFilePath}`);
    }
    throw err;
  }
}
