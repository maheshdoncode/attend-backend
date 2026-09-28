import bcrypt from 'bcryptjs';
import { supabase } from '../src/db/supabase.js';
import { encryptCredential } from '../src/utils/crypto.js';

async function seedOwner() {
  const email = 'owner@attendy.com';
  const password = 'password123';
  const salt = await bcrypt.genSalt(10);
  const password_hash = await bcrypt.hash(password, salt);

  const { data, error } = await supabase
    .from('users')
    .upsert(
      {
        name: 'Attendy Owner',
        email,
        password_hash,
        current_password: encryptCredential(password),
        role: 'owner',
        is_active: true,
      },
      { onConflict: 'email' }
    )
    .select()
    .single();

  if (error) {
    console.error('❌ Error seeding owner:', error.message);
  } else {
    console.log('✅ Successfully seeded owner user:');
    console.log(`   Email:    ${email}`);
    console.log(`   Password: ${password}`);
    console.log(`   Role:     ${data.role}`);
    console.log(`   ID:       ${data.id}`);
  }
}

seedOwner();
