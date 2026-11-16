/** GET /api/latest: the newest app version (public; no download link). */
import { json, latestRelease, preflight } from './_lib/store.js';

export function OPTIONS() {
  return preflight();
}

export async function GET() {
  try {
    const r = await latestRelease();
    if (!r) return json({ available: false });
    return json({
      available: true,
      version: r.version,
      notes: r.notes,
      size: r.size,
      publishedAt: r.publishedAt,
    });
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}
