/**
 * POST /api/redeem { code }: uses one download of the code and returns a one-time download link
 * (valid 15 minutes, works once). The code is only used when a release exists.
 */
import {
  clientKey,
  db,
  json,
  latestRelease,
  newId,
  normalizeCode,
  preflight,
  REDEEM_LUA,
} from './_lib/store.js';

const MAX_ATTEMPTS = 10;

export function OPTIONS() {
  return preflight();
}

export async function POST(req) {
  let body = {};
  try {
    body = await req.json();
  } catch {}
  const code = normalizeCode(body.code);
  if (code.length < 4)
    return json({ ok: false, error: 'invalid', message: 'Enter your download code.' }, 400);
  try {
    const r = db();
    const rl = `rl:${clientKey(req)}`;
    const attempts = await r.incr(rl);
    if (attempts === 1) await r.expire(rl, 600);
    if (attempts > MAX_ATTEMPTS)
      return json(
        {
          ok: false,
          error: 'rate_limited',
          message: 'Too many tries. Wait 10 minutes and try again.',
        },
        429,
      );
    const release = await latestRelease();
    if (!release)
      return json({ ok: false, error: 'no_release', message: 'No download is available yet.' }, 404);
    const now = new Date().toISOString();
    const res = Number(await r.eval(REDEEM_LUA, [`code:${code}`], [now]));
    if (res !== 1) {
      const message =
        res === 0
          ? 'This code has already been used.'
          : res === -2
            ? 'This code is no longer valid.'
            : 'That code is not right. Check it and try again.';
      return json({ ok: false, error: res === 0 ? 'used' : 'invalid', message }, 403);
    }
    const ticket = newId();
    await r.set(`ticket:${ticket}`, release.pathname, { ex: 900 });
    await r.lpush(
      'redemptions',
      JSON.stringify({ code, at: now, ua: (req.headers.get('user-agent') ?? '').slice(0, 120) }),
    );
    await r.ltrim('redemptions', 0, 499);
    const origin = new URL(req.url).origin;
    return json({
      ok: true,
      version: release.version,
      downloadUrl: `${origin}/api/download?t=${ticket}`,
    });
  } catch {
    return json(
      { ok: false, error: 'unavailable', message: 'Downloads are not available right now.' },
      503,
    );
  }
}
