import {
  createHash,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  secret: string,
  salt: Buffer,
  keyLength: number,
) => Promise<Buffer>;

/** Returns `salt:hash` (hex). Used for user passwords and device claim tokens. */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(secret, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifySecret(
  secret: string,
  stored: string,
): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) {
    return false;
  }
  const expected = Buffer.from(hash, 'hex');
  const actual = await scryptAsync(
    secret,
    Buffer.from(salt, 'hex'),
    expected.length,
  );
  return timingSafeEqual(actual, expected);
}

/** Random URL-safe token (refresh tokens, device secrets). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Fast hash for high-entropy tokens we need to look up by value (refresh tokens). */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const CLAIM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

/** Human-friendly single-use claim code for device labels, e.g. `K7QM-2XRP`. */
export function claimCode(): string {
  const chars = Array.from(
    { length: 8 },
    () => CLAIM_ALPHABET[randomInt(CLAIM_ALPHABET.length)],
  );
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

/** Accepts `k7qm 2xrp`, `K7QM2XRP`… and returns the canonical `K7QM-2XRP`. */
export function normalizeClaimCode(input: string): string {
  const chars = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}
