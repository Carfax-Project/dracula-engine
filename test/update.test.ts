import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findUpdate, isNewer } from '../src/main/update';

test('release tags compare as version numbers', () => {
  assert.ok(isNewer('v1.0.2', '1.0.1'));
  assert.ok(isNewer('v1.10.0', '1.9.9'));
  assert.ok(isNewer('v2', '1.9.9'));
  assert.ok(!isNewer('v1.0.1', '1.0.1'));
  assert.ok(!isNewer('v1.0.0', '1.0.1'));
  assert.ok(!isNewer('v1.0', '1.0.0'));
});

const release = (tag: string, format: string | null) => async (url: string) => {
  if (url.includes('api.github.com')) return Response.json({ tag_name: tag, html_url: `https://github.com/Carfax-Project/dracula-engine/releases/tag/${tag}` });
  return format === null ? new Response('', { status: 404 }) : new Response(`export const DATA_FORMAT = ${format};\n`);
};

test('a newer release is reported with its page', async () => {
  const u = await findUpdate(release('v1.1.0', '3'), '1.0.1', 3);
  assert.deepEqual(u, { version: '1.1.0', url: 'https://github.com/Carfax-Project/dracula-engine/releases/tag/v1.1.0', reimport: false });
});

test('a new data format asks for a re-import', async () => {
  assert.equal((await findUpdate(release('v2.0.0', '4'), '1.0.1', 3))?.reimport, true);
  assert.equal((await findUpdate(release('v2.0.0', null), '1.0.1', 3))?.reimport, false);
});

test('nothing to report', async () => {
  assert.equal(await findUpdate(release('v1.0.1', '3'), '1.0.1', 3), null);
  assert.equal(await findUpdate(async () => new Response('', { status: 403 }), '1.0.1', 3), null);
  const elsewhere = async () => Response.json({ tag_name: 'v9.0.0', html_url: 'https://example.com/x' });
  assert.equal(await findUpdate(elsewhere, '1.0.1', 3), null);
});
