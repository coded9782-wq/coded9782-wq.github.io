/**
 * POST /api/app-update (header x-app-key): the installed Minty app asks for the newest APK. No
 * download code: the key ships inside the app. Returns a one-time download link (15 minutes),
 * the same kind /api/redeem gives. Rate limited per client.
 */
import { timingSafeEqual } from 'node:crypto';
import { clientKey, db, json, latestRelease, newId, preflight } from './_lib/store.js';

const MAX_PER_10_MIN = 20;

function keyOk(req) {
  const expected = process.env.MINTY_APP_UPDATE_KEY ?? '';
  const got = req.headers.get('x-app-key') ?? '';
  if (expected.length < 16 || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export function OPTIONS() {
  return preflight();
}

export async function POST(req) {
  if (!keyOk(req)) return json({ ok: false, error: 'unauthorized', message: 'Update not allowed.' }, 401);
  try {
    const r = db();
    const rl = `ru:${clientKey(req)}`;
    const n = await r.incr(rl);
    if (n === 1) await r.expire(rl, 600);
    if (n > MAX_PER_10_MIN)
      return json({ ok: false, error: 'rate_limited', message: 'Too many tries. Wait 10 minutes.' }, 429);
    const release = await latestRelease();
    if (!release)
      return json({ ok: false, error: 'no_release', message: 'No update is available.' }, 404);
    const ticket = newId();
    await r.set(`ticket:${ticket}`, release.pathname, { ex: 900 });
    const now = new Date().toISOString();
    await r.lpush(
      'redemptions',
      JSON.stringify({ code: 'IN-APP', at: now, ua: (req.headers.get('user-agent') ?? '').slice(0, 120) }),
    );
    await r.ltrim('redemptions', 0, 499);
    const origin = new URL(req.url).origin;
    return json({ ok: true, version: release.version, downloadUrl: `${origin}/api/download?t=${ticket}` });
  } catch {
    return json({ ok: false, error: 'unavailable', message: 'Updates are not available right now.' }, 503);
  }
}
