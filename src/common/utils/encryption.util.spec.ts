import { encrypt, decrypt } from './encryption.util';

const TEST_KEY = Buffer.alloc(32); // 32 zero bytes — matches dev ENCRYPTION_KEY (64 zeros)
const PLAINTEXT = 'sk-ant-api03-super-secret-key-here';

describe('encryption.util', () => {
  describe('encrypt() / decrypt()', () => {
    it('round-trip: decrypt(encrypt(plaintext)) returns the original plaintext', () => {
      const { ciphertext, iv } = encrypt(PLAINTEXT, TEST_KEY);
      const result = decrypt(ciphertext, iv, TEST_KEY);
      expect(result).toBe(PLAINTEXT);
    });

    it('two encryptions of the same plaintext produce different ciphertexts (random IV)', () => {
      const first = encrypt(PLAINTEXT, TEST_KEY);
      const second = encrypt(PLAINTEXT, TEST_KEY);
      expect(first.ciphertext).not.toBe(second.ciphertext);
      expect(first.iv).not.toBe(second.iv);
    });

    it('decrypt with wrong key throws', () => {
      const { ciphertext, iv } = encrypt(PLAINTEXT, TEST_KEY);
      const wrongKey = Buffer.alloc(32, 0xff); // 32 bytes of 0xFF
      expect(() => decrypt(ciphertext, iv, wrongKey)).toThrow();
    });

    it('decrypt with tampered ciphertext throws (GCM auth tag verification)', () => {
      const { ciphertext, iv } = encrypt(PLAINTEXT, TEST_KEY);

      // Flip a byte in the middle of the ciphertext (before the auth tag)
      const tampered = Buffer.from(ciphertext, 'hex');
      tampered[4] ^= 0xff;

      expect(() => decrypt(tampered.toString('hex'), iv, TEST_KEY)).toThrow();
    });

    it('handles empty string plaintext', () => {
      const { ciphertext, iv } = encrypt('', TEST_KEY);
      expect(decrypt(ciphertext, iv, TEST_KEY)).toBe('');
    });

    it('handles unicode / long strings', () => {
      const long = 'sk-' + 'a'.repeat(200) + '🔑';
      const { ciphertext, iv } = encrypt(long, TEST_KEY);
      expect(decrypt(ciphertext, iv, TEST_KEY)).toBe(long);
    });
  });
});
