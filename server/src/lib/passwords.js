import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_BYTES = 64;

// scrypt ships with Node, so password hashing needs no third-party package.
export const hashPassword = (plain) => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(plain, salt, KEY_BYTES).toString('hex')}`;
};

export const verifyPassword = (plain, stored) => {
  const [salt, expectedHex] = String(stored).split(':');
  if (!salt || !expectedHex) return false;

  const expected = Buffer.from(expectedHex, 'hex');
  const actual = scryptSync(plain, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
