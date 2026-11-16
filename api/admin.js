/**
 * Admin API (header x-admin-key = MINTY_ADMIN_KEY).
 * GET  -> { codes, release, redemptions }
 * POST { action: 'create', code?, uses?, note? }
 *    | { action: 'revoke' | 'restore' | 'reset' | 'delete', code }
 *    | { action: 'download' } -> { downloadUrl } (admin download, uses no code)
 */
import { randomInt } from 'node:crypto';
import {
  adminGate,
  db,
  json,
  latestRelease,
  newId,
  normalizeCode,
  preflight,
} from './_lib/store.js';

export function OPTIONS() {
  return preflight();
}

async function snapshot() {
  const r = db();
  const names = ((await r.smembers('codes')) ?? []).map(String).sort();
  const codes = [];
  for (const name of names) {
    const h = (await r.hgetall(`code:${name}`)) ?? {};
    codes.push({
      code: name,
      uses: Number(h.uses ?? 1),
      used: Number(h.used ?? 0),
      revoked: String(h.revoked ?? '0') === '1',
      note: h.note ? String(h.note) : '',
      createdAt: h.createdAt ? String(h.createdAt) : null,
      lastUsedAt: h.lastUsedAt ? String(h.lastUsedAt) : null,
    });
  }
  const redemptions = ((await r.lrange('redemptions', 0, 49)) ?? []).map((x) =>
    typeof x === 'string' ? JSON.parse(x) : x,
  );
  return { codes, release: await latestRelease(), redemptions };
}

export async function GET(req) {
  const denied = await adminGate(req);
  if (denied) return denied;
  return json(await snapshot());
}

export async function POST(req) {
  const denied = await adminGate(req);
  if (denied) return denied;
  let b = {};
  try {
    b = await req.json();
  } catch {}
  const r = db();
  const code = normalizeCode(b.code);
  switch (b.action) {
    case 'create': {
      const name = code || String(randomInt(100000, 1000000));
      if (name.length < 4) return json({ error: 'Code must be at least 4 characters.' }, 400);
      if (await r.exists(`code:${name}`)) return json({ error: 'That code already exists.' }, 409);
      const uses = Math.max(1, Math.min(1000, Number(b.uses) || 1));
      await r.hset(`code:${name}`, {
        uses,
        used: 0,
        revoked: 0,
        note: String(b.note ?? '').slice(0, 200),
        createdAt: new Date().toISOString(),
      });
      await r.sadd('codes', name);
      break;
    }
    case 'revoke':
    case 'restore':
      if (!(await r.exists(`code:${code}`))) return json({ error: 'No such code.' }, 404);
      await r.hset(`code:${code}`, { revoked: b.action === 'revoke' ? 1 : 0 });
      break;
    case 'reset':
      if (!(await r.exists(`code:${code}`))) return json({ error: 'No such code.' }, 404);
      await r.hset(`code:${code}`, { used: 0 });
      break;
    case 'download': {
      // The admin's own download: no code is used. One-time link, 15 minutes.
      const release = await latestRelease();
      if (!release) return json({ error: 'No app file is published yet.' }, 404);
      const ticket = newId();
      await r.set(`ticket:${ticket}`, release.pathname, { ex: 900 });
      await r.lpush(
        'redemptions',
        JSON.stringify({ code: 'ADMIN', at: new Date().toISOString(), ua: 'Admin page' }),
      );
      await r.ltrim('redemptions', 0, 499);
      return json({ downloadUrl: `${new URL(req.url).origin}/api/download?t=${ticket}` });
    }
    case 'delete':
      await r.del(`code:${code}`);
      await r.srem('codes', code);
      break;
    default:
      return json({ error: 'Unknown action.' }, 400);
  }
  return json(await snapshot());
}
