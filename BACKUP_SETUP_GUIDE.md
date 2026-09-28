# 💾 Automated Database Backup System — Setup Guide

This guide explains how to configure and use the **Automated PostgreSQL Database Backup System** with Google Drive Cloud Storage (15GB free personal storage support) and dynamic cron scheduling for **Attendy HRMS**.

---

## 📑 Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Environment Variables (`.env`)](#2-environment-variables-env)
3. [Google Cloud Console & OAuth2 Setup](#3-google-cloud-console--oauth2-setup)
4. [1-Click Refresh Token Generation](#4-1-click-refresh-token-generation)
5. [Supabase Database URL Setup](#5-supabase-database-url-setup)
6. [Testing & Triggering Backups](#6-testing--triggering-backups)
7. [API Endpoints Reference](#7-api-endpoints-reference)
8. [Troubleshooting & Common Gotchas](#8-troubleshooting--common-gotchas)

---

## 1. Architecture Overview

```mermaid
graph TD
    A[Cron Scheduler: Daily 2:00 AM] -->|Tick| B(Backup Engine)
    C[Admin API: POST /api/hrm/backup/trigger] -->|On Demand| B
    
    B -->|1. Direct DB Query / Dump| D[(Supabase PostgreSQL)]
    D -->|2. Stream Tables & Rows| B
    B -->|3. Generate Clean Timestamped .sql| E[./backups/backup_YYYY-MM-DD_HH-mm-ss.sql]
    
    B -->|4. Upload File via OAuth2| F[Google Drive: Backups Folder]
    F -->|5. Prune Old Backups| G[Keep Last 7 Backups Only]
    
    B -->|6. Cleanup| H[Delete Local Temp .sql]
```

- **Dual-Engine Dumper**: If `pg_dump` CLI is not installed on the system, the built-in Node.js PostgreSQL engine dumps all schemas, table definitions, sequences, indexes, and row data in dependency order.
- **Clean Database Restores**: Output `.sql` file includes `uuid-ossp`, `pgcrypto`, custom types, table definitions with primary keys, indexes, and uses `SET session_replication_role = 'replica';` during inserts to ensure zero foreign key errors on a fresh database restore.
- **7-Day Retention**: Google Drive automatically prunes backup files older than the 7 most recent backups to prevent storage overflow.
- **Dynamic Cron**: Modify the cron schedule on-the-fly via API without restarting the backend service.

---

## 2. Environment Variables (`.env`)

Add these variables to your `.env` file in `Attendy-backend/`:

```env
# 1. Supabase Direct PostgreSQL Connection String
SUPABASE_DB_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres

# 2. Google Drive OAuth2 Credentials (Supports free personal 15GB Drive)
GDRIVE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GDRIVE_CLIENT_SECRET=your_client_secret
GDRIVE_REFRESH_TOKEN=your_refresh_token
GOOGLE_DRIVE_FOLDER_ID=your_google_drive_folder_id

# 3. Scheduler & Storage Defaults
BACKUP_DIR=./backups
DEFAULT_CRON_SCHEDULE=0 2 * * *
```

---

## 3. Google Cloud Console & OAuth2 Setup

To upload backups into your **15GB personal Google Drive**:

### Step 3.1: Enable Google Drive API
1. Open **[Google Cloud Console](https://console.cloud.google.com)**.
2. Select your project.
3. Search for **"Google Drive API"** and click **Enable**.

### Step 3.2: Configure OAuth Consent Screen
1. Go to **APIs & Services ➔ OAuth Consent Screen**.
2. Select **External** and click **Create**.
3. Fill in App name (e.g. `Attendy Backup`) and your developer contact email.
4. In the **Test users** tab, add your Google account email and save.

### Step 3.3: Create OAuth 2.0 Client ID
1. Go to **APIs & Services ➔ Credentials**.
2. Click **+ CREATE CREDENTIALS** ➔ **OAuth client ID**.
3. Configure:
   - **Application type:** `Web application`
   - **Name:** `Attendy Backup Client`
   - **Authorized redirect URIs:** Add `http://localhost:3333/oauth2callback`
4. Click **Create** and paste `GDRIVE_CLIENT_ID` and `GDRIVE_CLIENT_SECRET` into `.env`.

---

## 4. 1-Click Refresh Token Generation

Run the automated script to authenticate and write the refresh token directly to `.env`:

```bash
npm run gdrive-auth
```

1. It outputs an authorization URL in the terminal.
2. Open the URL in your browser, select your Google account, and click **Allow**.
3. The script captures the `refresh_token` and automatically saves it into `.env`!

---

## 5. Supabase Database URL Setup

1. Open **[Supabase Dashboard ➔ Project Settings ➔ Database](https://supabase.com/dashboard/project/_/settings/database)**.
2. Under **Connection string**, select **URI** (Direct Connection):
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   ```
3. If your password contains special characters like `@` or `!`, URL-encode them:
   - `@` ➔ `%40`
   - `!` ➔ `%21`
   - `#` ➔ `%23`
4. Save in `.env` as `SUPABASE_DB_URL`.

---

## 6. Testing & Triggering Backups

### Run a Test from Terminal:
```bash
node -e "import('dotenv/config').then(() => import('./src/backup/backupService.js')).then(m => m.runBackup()).then(console.log).catch(console.error);"
```

### Test via Postman / cURL:
```bash
curl -X POST http://localhost:8000/api/hrm/backup/trigger \
  -H "Authorization: Bearer <OWNER_OR_ADMIN_JWT_TOKEN>"
```

Expected Response:
```json
{
  "success": true,
  "message": "Backup completed successfully",
  "filename": "backup_2026-09-28_08-30-00.sql",
  "driveFileId": "10MziaKbf0XDya6-23qpJ7eVOWo5OgGDA",
  "timestamp": "2026-09-28T03:00:00.000Z",
  "prunedCount": 0
}
```

---

## 7. API Endpoints Reference

All endpoints are mounted under both `/api/hrm/backup` and `/api/backup`, protected by Owner/Admin JWT or `CRON_SECRET`:

### 1. `POST /api/hrm/backup/trigger`
Immediately triggers a full database dump and uploads it to Google Drive.
- **Response `200`**:
  ```json
  {
    "success": true,
    "message": "Backup completed successfully",
    "filename": "backup_2026-09-28_08-30-00.sql",
    "driveFileId": "1ABC...",
    "timestamp": "2026-09-28T03:00:00.000Z",
    "prunedCount": 0
  }
  ```

### 2. `GET /api/hrm/backup/schedule`
Returns current cron schedule and plain-English description.
- **Response `200`**:
  ```json
  {
    "success": true,
    "schedule": "0 2 * * *",
    "description": "At 02:00 AM",
    "isActive": true
  }
  ```

### 3. `PUT /api/hrm/backup/schedule`
Updates cron schedule dynamically in memory without restarting the server.
- **Body**: `{ "schedule": "0 4 * * *" }`
- **Response `200`**:
  ```json
  {
    "success": true,
    "message": "Schedule updated successfully",
    "newSchedule": "0 4 * * *",
    "description": "At 04:00 AM"
  }
  ```

---

## 8. Troubleshooting & Common Gotchas

| Issue | Cause | Fix |
| :--- | :--- | :--- |
| `Service Accounts do not have storage quota` | Personal `@gmail.com` Drive folders do not allow free Service Account uploads | Use Google OAuth2 credentials (`GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET`, `GDRIVE_REFRESH_TOKEN`) with `npm run gdrive-auth`. |
| `invalid_grant` / `Bad Request` | Refresh token expired or revoked | Run `npm run gdrive-auth` to generate a fresh token in 10 seconds. |
| `Access blocked: Error 403` | User not in OAuth Test users list | In Google Cloud ➔ OAuth consent screen ➔ Test users ➔ Add your email. |
| DB Auth Failure | Special characters in DB password broken by URI parser | URL-encode password characters (`@` ➔ `%40`, `!` ➔ `%21`, `#` ➔ `%23`). |
| `pg_dump: command not found` | Local OS does not have PostgreSQL CLI tools in PATH | The backup engine automatically switches to the built-in Node.js PostgreSQL dumper. No action needed! |
