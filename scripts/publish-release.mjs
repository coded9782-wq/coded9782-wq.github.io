/**
 * Publish a new Minty APK for code-protected download.
 *
 *   node scripts/publish-release.mjs <path/to/app.apk> <version> ["What's new"]
 *   node scripts/publish-release.mjs --code 092521 [--uses 1] [--note "for Ana"]
 *
 * Reads BLOB_READ_WRITE_TOKEN and the Upstash credentials from .env.local
 * (run `npx vercel env pull .env.local --yes` first). The APK goes to the PRIVATE blob store under
 * a random path, then the `release` record in the database points to it. Older APKs are deleted.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { list, del, put } from '@vercel/blob';
import { Redis } from '@upstash/redis';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN,
});

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (flag('--code')) {
  const code = flag('--code').trim().toUpperCase();
  const uses = Number(flag('--uses') ?? 1);
  await redis.hset(`code:${code}`, {
    uses,
    used: 0,
    revoked: 0,
    note: flag('--note') ?? '',
    createdAt: new Date().toISOString(),
  });
  await redis.sadd('codes', code);
  console.log(`Code ${code} ready: ${uses} download(s).`);
  process.exit(0);
}

const [file, version, notes = ''] = args;
if (!file || !version) {
  console.error('Usage: node scripts/publish-release.mjs <app.apk> <version> ["notes"]');
  process.exit(1);
}
const size = statSync(file).size;
const pathname = `releases/${randomBytes(12).toString('hex')}/minty-${version}.apk`;
console.log(`Uploading ${(size / 1e6).toFixed(1)} MB as ${version} ...`);
const blob = await put(pathname, readFileSync(file), {
  access: 'private',
  contentType: 'application/vnd.android.package-archive',
  multipart: true,
});
await redis.hset('release', {
  version,
  notes,
  size,
  pathname: blob.pathname,
  publishedAt: new Date().toISOString(),
});
const { blobs } = await list({ prefix: 'releases/' });
const old = blobs.filter((b) => b.pathname !== blob.pathname).map((b) => b.url);
if (old.length) await del(old);
console.log(`Published Minty ${version}. Removed ${old.length} older file(s).`);
