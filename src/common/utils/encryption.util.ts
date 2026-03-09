import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export interface EncryptResult {
  /** Hex-encoded ciphertext with auth tag appended */
  ciphertext: string;
  /** Hex-encoded IV — must be stored alongside ciphertext */
  iv: string;
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 *
 * A fresh random IV is generated for every call — never reused.
 * The 16-byte GCM auth tag is appended to the ciphertext so that a single
 * hex string carries everything decrypt() needs (except the IV and key).
 */
export function encrypt(plaintext: string, key: Buffer): EncryptResult {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: Buffer.concat([encrypted, authTag]).toString('hex'),
    iv: iv.toString('hex'),
  };
}

/**
 * Decrypt a ciphertext produced by encrypt().
 *
 * GCM authentication is verified before any plaintext is returned.
 * Throws if the key is wrong or the ciphertext has been tampered with —
 * never returns garbage silently (unlike CBC mode).
 */
export function decrypt(ciphertext: string, iv: string, key: Buffer): string {
  const data = Buffer.from(ciphertext, 'hex');
  const ivBuf = Buffer.from(iv, 'hex');

  // Auth tag is the last 16 bytes appended by encrypt()
  const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
  const encrypted = data.subarray(0, data.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, ivBuf);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
}
