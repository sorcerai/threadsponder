/**
 * Credential Encryption Utility
 *
 * Uses AES-256-GCM for symmetric encryption of sensitive credentials.
 * Encryption key derived from CREDENTIAL_ENCRYPTION_KEY env var or random fallback.
 *
 * Security Expert: Bruce Schneier - Cryptography & Key Management
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

// AES-256-GCM configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

/**
 * Derives a 256-bit key from password using scrypt.
 * Uses high memory cost to resist brute-force attacks.
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  // scrypt parameters: N=2^15, r=8, p=1 (recommended for 2024+)
  // maxmem must be explicitly set: 128 * N * r = 128 * 32768 * 8 = 32MB + headroom
  return scryptSync(password, salt, KEY_LENGTH, { N: 32768, r: 8, p: 1, maxmem: 67108864 });
}

/**
 * Gets the encryption key from environment or generates a session key.
 * Warning: Session keys are lost on restart - configure CREDENTIAL_ENCRYPTION_KEY for persistence.
 */
let sessionKey: string | null = null;

function getEncryptionKey(): string {
  // Prefer environment variable for persistent encryption
  if (process.env.CREDENTIAL_ENCRYPTION_KEY) {
    return process.env.CREDENTIAL_ENCRYPTION_KEY;
  }

  // Fallback: Generate session-only key (credentials lost on restart without env key)
  if (!sessionKey) {
    sessionKey = randomBytes(32).toString('hex');
    console.warn('[SECURITY] Using session-only encryption key. Set CREDENTIAL_ENCRYPTION_KEY for persistent storage.');
  }
  return sessionKey;
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns base64 encoded string: salt.iv.authTag.ciphertext
 *
 * @param plaintext - The data to encrypt
 * @returns Encrypted string (base64) or null on error
 */
export function encryptCredential(plaintext: string): string | null {
  if (!plaintext || typeof plaintext !== 'string') {
    return null;
  }

  try {
    const password = getEncryptionKey();
    const salt = randomBytes(SALT_LENGTH);
    const key = deriveKey(password, salt);
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Combine: salt + iv + authTag + ciphertext
    const combined = Buffer.concat([salt, iv, authTag, encrypted]);
    return combined.toString('base64');
  } catch (error) {
    console.error('[ENCRYPTION] Failed to encrypt:', error);
    return null;
  }
}

/**
 * Decrypts ciphertext using AES-256-GCM.
 *
 * @param ciphertext - Base64 encoded encrypted string
 * @returns Decrypted plaintext or null on error
 */
export function decryptCredential(ciphertext: string): string | null {
  if (!ciphertext || typeof ciphertext !== 'string') {
    return null;
  }

  try {
    const password = getEncryptionKey();
    const combined = Buffer.from(ciphertext, 'base64');

    // Extract components
    const salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

    const key = deriveKey(password, salt);

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (error) {
    // Don't log full error - could expose crypto details
    console.error('[ENCRYPTION] Decryption failed (invalid key or corrupted data)');
    return null;
  }
}

/**
 * Encrypts an entire credentials object.
 * Each sensitive field is encrypted individually for granular access.
 *
 * @param credentials - Object with credential fields
 * @returns Object with encrypted sensitive fields
 */
export function encryptCredentials(credentials: Record<string, any>): Record<string, any> {
  const sensitiveFields = [
    'openrouterApiKey',
    'threadsAccessToken',
    'threadsAppSecret',
    'supabaseServiceKey',
    'stripeSecretKey',
    'apiKey',
    'secretKey',
    'password',
    'token'
  ];

  const encrypted = { ...credentials };

  for (const field of sensitiveFields) {
    if (credentials[field] && typeof credentials[field] === 'string') {
      const encryptedValue = encryptCredential(credentials[field]);
      if (encryptedValue) {
        encrypted[field] = encryptedValue;
        encrypted[`${field}_encrypted`] = true;
      }
    }
  }

  return encrypted;
}

/**
 * Decrypts an entire credentials object.
 *
 * @param credentials - Object with encrypted credential fields
 * @returns Object with decrypted fields
 */
export function decryptCredentials(credentials: Record<string, any>): Record<string, any> {
  const sensitiveFields = [
    'openrouterApiKey',
    'threadsAccessToken',
    'threadsAppSecret',
    'supabaseServiceKey',
    'stripeSecretKey',
    'apiKey',
    'secretKey',
    'password',
    'token'
  ];

  const decrypted = { ...credentials };

  for (const field of sensitiveFields) {
    if (credentials[`${field}_encrypted`] && credentials[field]) {
      const decryptedValue = decryptCredential(credentials[field]);
      if (decryptedValue) {
        decrypted[field] = decryptedValue;
      } else {
        // Decryption failed - field may be corrupted or key changed
        delete decrypted[field];
      }
      delete decrypted[`${field}_encrypted`];
    }
  }

  return decrypted;
}

/**
 * Checks if credentials are encrypted.
 *
 * @param credentials - Object to check
 * @returns true if any sensitive field is encrypted
 */
export function areCredentialsEncrypted(credentials: Record<string, any>): boolean {
  const encryptedFlags = [
    'openrouterApiKey_encrypted',
    'threadsAccessToken_encrypted',
    'threadsAppSecret_encrypted',
    'supabaseServiceKey_encrypted',
    'stripeSecretKey_encrypted',
    'apiKey_encrypted',
    'secretKey_encrypted',
    'password_encrypted',
    'token_encrypted'
  ];

  return encryptedFlags.some(flag => credentials[flag]);
}
