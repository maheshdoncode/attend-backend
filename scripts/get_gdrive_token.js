import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const CLIENT_ID = process.env.GDRIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3333/oauth2callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n❌ ERROR: GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET must be set in your .env file.');
  console.error('Please add them to .env and re-run this script.\n');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const scopes = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file'
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: scopes
});

const server = http.createServer(async (req, res) => {
  const reqUrl = url.parse(req.url, true);

  if (reqUrl.pathname === '/oauth2callback') {
    const code = reqUrl.query.code;
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h3>Error: No authorization code found in request.</h3>');
      return;
    }

    try {
      const { tokens } = await oauth2Client.getToken(code);
      console.log('\n🎉 Successfully obtained Google Drive OAuth tokens!');
      console.log('Refresh Token:', tokens.refresh_token);

      if (tokens.refresh_token) {
        // Update .env file automatically
        const envPath = path.resolve(process.cwd(), '.env');
        let envContent = '';
        if (fs.existsSync(envPath)) {
          envContent = fs.readFileSync(envPath, 'utf8');
        }

        if (envContent.includes('GDRIVE_REFRESH_TOKEN=')) {
          envContent = envContent.replace(/GDRIVE_REFRESH_TOKEN=.*/, `GDRIVE_REFRESH_TOKEN=${tokens.refresh_token}`);
        } else {
          envContent += `\nGDRIVE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
        }

        fs.writeFileSync(envPath, envContent, 'utf8');
        console.log('✅ Updated GDRIVE_REFRESH_TOKEN in .env file automatically!');
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: #2e7d32;">🎉 Google Drive Connected Successfully for Attendy!</h1>
          <p>Your refresh token has been securely saved to <code>.env</code>.</p>
          <p>You can now close this tab and return to the terminal.</p>
        </div>
      `);

      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 2000);
    } catch (err) {
      console.error('Error exchanging token:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<h3>Error exchanging token: ${err.message}</h3>`);
    }
  }
});

server.listen(3333, () => {
  console.log('\n======================================================');
  console.log('🔗 STEP 1: Ensure this redirect URI is in your Google Cloud OAuth Client:');
  console.log('   http://localhost:3333/oauth2callback');
  console.log('======================================================');
  console.log('\n👉 STEP 2: Open this URL in your browser to authorize:');
  console.log(authUrl);
  console.log('\nWaiting for authorization...\n');
});
