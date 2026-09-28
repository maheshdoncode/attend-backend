import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.POSTMAN_API_KEY;
const COLLECTION_ID = process.env.POSTMAN_COLLECTION_ID || '555c6198-a98f-4039-aff7-3a5a3261929c';

if (!API_KEY) {
  console.error('\n❌ ERROR: POSTMAN_API_KEY must be set in your .env file.');
  console.error('Please add POSTMAN_API_KEY=your_key in .env to sync with Postman Cloud.\n');
  process.exit(1);
}

async function syncPostman() {
  const collectionPath = path.resolve(process.cwd(), 'Attendy_HRMS_Postman_Collection.json');
  if (!fs.existsSync(collectionPath)) {
    console.error('❌ Error: Attendy_HRMS_Postman_Collection.json not found');
    process.exit(1);
  }

  const localCollection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));

  console.log(`📡 Syncing collection to Postman Cloud (ID: ${COLLECTION_ID})...`);

  try {
    const res = await fetch(`https://api.getpostman.com/collections/${COLLECTION_ID}`, {
      method: 'PUT',
      headers: {
        'X-Api-Key': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ collection: localCollection })
    });

    const data = await res.json();
    if (res.ok && data.collection) {
      console.log('✅ Successfully updated Postman Collection on Postman Cloud:');
      console.log(`   Name: ${data.collection.name}`);
      console.log(`   ID:   ${data.collection.id}`);
      console.log(`   UID:  ${data.collection.uid}`);
    } else {
      console.error('❌ Failed to update Postman Collection:', data);
    }
  } catch (err) {
    console.error('❌ Error updating Postman Collection:', err.message);
  }
}

syncPostman();
