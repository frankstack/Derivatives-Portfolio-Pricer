// The owner passcode and the short-lived token it buys.
// The passcode itself is never stored: only a salted scrypt hash
// (scrypt:N:r:p:salt:hash, no characters a shell or env file would expand),
// set with set-owner-passcode.mjs. A token is "expiry.signature"; it carries nothing else.

import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const N = 16384, R = 8, P = 1, KEYLEN = 32;

export function hashPasscode(passcode, salt = randomBytes(16)) {
  const hash = scryptSync(String(passcode), salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join(':');
}

export function verifyPasscode(passcode, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  if (!(n >= 1024 && n <= 1048576 && r > 0 && r <= 32 && p > 0 && p <= 16)) return false;
  let salt, want;
  try {
    salt = Buffer.from(parts[4], 'base64');
    want = Buffer.from(parts[5], 'base64');
  } catch (e) {
    return false;
  }
  if (salt.length < 8 || want.length < 16) return false;
  const got = scryptSync(String(passcode), salt, want.length, { N: n, r, p, maxmem: 256 * n * r });
  return got.length === want.length && timingSafeEqual(got, want);
}

// A random key kept next to the budget file. Mixed with the passcode hash, so a
// new passcode ends every token issued under the old one.
export function loadSigningKey(stateDir, ownerHash) {
  mkdirSync(stateDir, { recursive: true });
  const file = join(stateDir, 'token.key');
  let seed;
  if (existsSync(file)) seed = readFileSync(file);
  if (!seed || seed.length < 32) {
    seed = randomBytes(32);
    writeFileSync(file, seed, { mode: 0o600 });
  }
  return createHmac('sha256', seed).update('dpp-ai-owner-token:' + String(ownerHash || '')).digest();
}

const sign = (key, exp) => createHmac('sha256', key).update(String(exp)).digest('base64url');

export function issueToken(key, ttlMs, now = Date.now()) {
  const exp = now + ttlMs;
  return { token: exp + '.' + sign(key, exp), expiresAt: exp };
}

export function verifyToken(key, token, now = Date.now()) {
  const m = /^(\d{10,16})\.([A-Za-z0-9_-]{20,100})$/.exec(String(token || ''));
  if (!m) return false;
  const exp = Number(m[1]);
  if (!(exp > now)) return false;
  const want = Buffer.from(sign(key, exp));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got);
}
