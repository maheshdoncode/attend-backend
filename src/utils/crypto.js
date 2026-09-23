import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const TAG_LENGTH = 16; // 128 bits auth tag

/**
 * Derives a 32-byte key from the application secret
 */
const getSecretKey = () => {
  const secret = process.env.ENCRYPTION_SECRET || process.env.JWT_SECRET || 'attendy_default_secret_encryption_key_2026';
  return crypto.createHash('sha256').update(secret).digest();
};

/**
 * Encrypts plain text using AES-256-GCM.
 * @param {string} text
 * @returns {string} Encrypted string in format: "enc:iv:tag:ciphertext" (base64)
 */
export const encryptCredential = (text) => {
  if (!text || typeof text !== 'string') return null;

  try {
    const key = getSecretKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');
    const ivHex = iv.toString('hex');

    return `enc:${ivHex}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('Encryption error:', err);
    return text; // fallback
  }
};

/**
 * Decrypts an AES-256-GCM encrypted string.
 * Supports legacy unencrypted strings seamlessly.
 * @param {string} cipherText
 * @returns {string} Decrypted plain text
 */
export const decryptCredential = (cipherText) => {
  if (!cipherText || typeof cipherText !== 'string') return null;

  // If not formatted with "enc:" prefix, it was stored unencrypted (legacy)
  if (!cipherText.startsWith('enc:')) {
    return cipherText;
  }

  try {
    const parts = cipherText.split(':');
    if (parts.length !== 4) return cipherText;

    const [, ivHex, tagHex, encryptedHex] = parts;
    const key = getSecretKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.error('Decryption error:', err);
    return cipherText;
  }
};

export default {
  encryptCredential,
  decryptCredential,
};
