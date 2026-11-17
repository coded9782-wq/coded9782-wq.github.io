/**
 * Shared helpers for the download-code API.
 *
 * Data (Upstash Redis, managed from /admin.html or the Upstash console):
 *   code:<CODE>   hash   uses, used, revoked (0/1), note, createdAt, lastUsedAt
 *   codes         set    every code name
 *   redemptions   list   JSON { code, at, ua } (newest first, last 500)
 *   ticket:<id>   string blob pathname; one download, expires after 15 minutes
 *   release       hash   version, notes, pathname, size, publishedAt
 *   rl:<hash>     int    redeem attempts per client per 10 minutes (brute-force guard)
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Redis } from '@upstash/redis';

let redis;
export function db() {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
    if (!url || !token) throw new Error('Database is not connected');
    redis = new Redis({ url, token });
  }
  return redis;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-app-key',
  'cache-control': 'no-store',
};

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

export function normalizeCode(raw) {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 40);
}

export function newId(bytes = 18) {
  return randomBytes(bytes).toString('base64url');
}

export function clientKey(req) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  // Hashed and short-lived: the raw address is never stored.
  return createHash('sha256').update(`minty:${ip}`).digest('base64url').slice(0, 22);
}

const ADMIN_MAX_FAILS = 8;

/**
 * Admin gate: null when the key is right, else the response to send. After 8 wrong keys from one
 * client, that client is locked out for 30 minutes (even with the right key).
 */
export async function adminGate(req) {
  const lock = `al:${clientKey(req)}`;
  const fails = Number((await db().get(lock)) ?? 0);
  if (fails >= ADMIN_MAX_FAILS)
    return json({ error: 'Too many wrong keys. Locked for 30 minutes.' }, 429);
  if (isAdmin(req)) return null;
  const n = await db().incr(lock);
  if (n === 1) await db().expire(lock, 1800);
  return json({ error: 'unauthorized' }, 401);
}

export function isAdmin(req) {
  const expected = process.env.MINTY_ADMIN_KEY ?? '';
  const got = req.headers.get('x-admin-key') ?? '';
  if (expected.length < 16 || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/** Atomically use one download of a code. 1 ok, 0 used up, -1 unknown, -2 revoked. */
export const REDEEM_LUA = `
local k = KEYS[1]
if redis.call('EXISTS', k) == 0 then return -1 end
if redis.call('HGET', k, 'revoked') == '1' then return -2 end
local uses = tonumber(redis.call('HGET', k, 'uses') or '1')
local used = tonumber(redis.call('HGET', k, 'used') or '0')
if used >= uses then return 0 end
redis.call('HINCRBY', k, 'used', 1)
redis.call('HSET', k, 'lastUsedAt', ARGV[1])
return 1
`;

export async function latestRelease() {
  const r = await db().hgetall('release');
  if (!r?.pathname) return null;
  return {
    version: String(r.version),
    notes: r.notes ? String(r.notes) : '',
    size: Number(r.size) || null,
    publishedAt: r.publishedAt ? String(r.publishedAt) : null,
    pathname: String(r.pathname),
  };
}
