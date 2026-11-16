/** GET /api/download?t=<ticket>: one download per ticket, then a short-lived private file link. */
import { issueSignedToken, presignUrl } from '@vercel/blob';
import { db } from './_lib/store.js';

function page(status, text) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Minty download</title><body style="font-family:system-ui;padding:32px;max-width:520px;margin:auto"><h1>Minty</h1><p>${text}</p><p><a href="/#get">Back to the website</a></p></body>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    },
  );
}

export async function GET(req) {
  const t = new URL(req.url).searchParams.get('t') ?? '';
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(t)) return page(400, 'This download link is not valid.');
  try {
    const pathname = await db().getdel(`ticket:${t}`);
    if (!pathname)
      return page(
        410,
        'This download link was already used or has expired. Each code gives one download.',
      );
    const validUntil = Date.now() + 5 * 60 * 1000;
    const token = await issueSignedToken({
      pathname: String(pathname),
      operations: ['get'],
      validUntil,
    });
    const { presignedUrl } = await presignUrl(token, {
      operation: 'get',
      pathname: String(pathname),
      validUntil,
      access: 'private',
    });
    return new Response(null, {
      status: 302,
      headers: {
        location: presignedUrl,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  } catch (e) {
    console.error('download failed', e);
    return page(503, 'The download is not available right now. Try again in a minute.');
  }
}
