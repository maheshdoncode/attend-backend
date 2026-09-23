import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

/**
 * CLI Helper to publish a new APK release to Attendy HRMS.
 * Usage:
 *   node scripts/publish_release.js <version_name> <version_code> <apk_url> [min_supported_version_code] [is_force_update] [release_notes]
 *
 * Example:
 *   node scripts/publish_release.js 1.2.0 15 "https://my-storage.com/attendy-1.2.0.apk" 12 false "• Advance salary\n• Bug fixes"
 */

const BASE_URL = process.env.API_URL || 'http://localhost:8000/api/hrm';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'owner@attendy.com';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'password123';

async function main() {
  const args = process.argv.slice(2);
  const versionName = args[0] || '1.1.0';
  const versionCode = parseInt(args[1] || '12', 10);
  const apkUrl = args[2] || 'https://dyrfhzoxvkiaquvpoxyk.supabase.co/storage/v1/object/public/app-releases/attendy-v' + versionName + '.apk';
  const minVersionCode = args[3] ? parseInt(args[3], 10) : null;
  const isForceUpdate = args[4] === 'true';
  const releaseNotes = args[5] || '• Performance and stability enhancements\n• New features and bug fixes';

  console.log('🚀 Publishing App Release...');
  console.log(`   Version Name:  ${versionName}`);
  console.log(`   Version Code:  ${versionCode}`);
  console.log(`   APK URL:       ${apkUrl}`);
  console.log(`   Force Update:  ${isForceUpdate}`);
  console.log(`   Min Supported: ${minVersionCode || 'None'}`);

  // 1. Authenticate as Owner
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });

  const loginData = await loginRes.json();
  if (!loginData.success || !loginData.token) {
    console.error('❌ Failed to authenticate as owner:', loginData);
    process.exit(1);
  }

  const token = loginData.token;

  // 2. Publish Release
  const pubRes = await fetch(`${BASE_URL}/app-updates/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      platform: 'android',
      version_name: versionName,
      version_code: versionCode,
      min_supported_version_code: minVersionCode,
      apk_url: apkUrl,
      release_notes: releaseNotes,
      is_active: true,
      is_force_update: isForceUpdate,
    }),
  });

  const pubData = await pubRes.json();
  if (pubData.success) {
    console.log('✅ Successfully published release:');
    console.log(JSON.stringify(pubData.data, null, 2));
  } else {
    console.error('❌ Failed to publish release:', pubData);
    process.exit(1);
  }
}

main().catch(console.error);
