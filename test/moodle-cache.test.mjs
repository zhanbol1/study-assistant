import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadValidatedFile } from '../lms-agent/src/browser/files.js';
import { createStore } from '../desktop/store.mjs';

test('unchanged authenticated files use conditional requests; changed or damaged copies download again', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moodle-cache-'));
  const activity = { id: '1', url: 'https://ucasaslms.org/mod/resource/view.php?id=1' };
  const file = { id: 'activity:1', type: 'resource' };
  let version = 'first', bodies = 0, requests = 0;
  const context = { request: { get: async (url, { headers }) => {
    requests++;
    const status = headers['If-None-Match'] === version ? 304 : 200;
    return { status: () => status, ok: () => status === 200, url: () => url, headers: () => ({ etag: version, 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="lecture.pptx"' }), body: async () => { bodies++; return Buffer.from(version); }, dispose: async () => {} };
  } } };
  try {
    const first = await downloadValidatedFile(context, '10', activity, file, directory);
    const same = await downloadValidatedFile(context, '10', activity, file, directory);
    assert.equal(same.reused, true); assert.equal(same.file.path, first.file.path);
    assert.equal(requests, 2); assert.equal(bodies, 1);
    version = 'second';
    const changed = await downloadValidatedFile(context, '10', activity, file, directory);
    assert.equal(changed.reused, false); assert.equal(await fs.readFile(changed.file.path, 'utf8'), version);
    await fs.writeFile(changed.file.path, 'damage'); // Same length, different hash.
    const repaired = await downloadValidatedFile(context, '10', activity, file, directory);
    assert.equal(repaired.reused, false); assert.equal(bodies, 3);
    await fs.unlink(repaired.file.path);
    assert.equal((await downloadValidatedFile(context, '10', activity, file, directory)).reused, false);
    const otherSession = { request: context.request };
    assert.equal((await downloadValidatedFile(otherSession, '10', activity, file, directory)).reused, false);
    const store = createStore(':memory:');
    try {
      const input = { ...first.file, course: 'Fixture', sourceUrl: activity.url };
      assert.equal(store.addDownload(input).id, store.addDownload(input).id);
      assert.equal(store.snapshot().downloads.length, 1);
    } finally { store.close(); }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('cached downloads still reject external redirects and revoked access', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moodle-access-'));
  const activity = { id: '1', url: 'https://ucasaslms.org/mod/resource/view.php?id=1' };
  const file = { id: 'activity:1', type: 'resource' };
  let status = 200, requests = 0;
  const context = { request: { get: async url => { requests++; return { status: () => status, ok: () => status === 200, url: () => url, headers: () => ({ etag: 'same', 'content-type': 'application/octet-stream', location: 'https://external.invalid/secret' }), body: async () => Buffer.from('fixture'), dispose: async () => {} }; } } };
  try {
    await downloadValidatedFile(context, '10', activity, file, directory);
    status = 403;
    await assert.rejects(downloadValidatedFile(context, '10', activity, file, directory), /download failed/);
    status = 302;
    await assert.rejects(downloadValidatedFile(context, '10', activity, file, directory), /External/);
    assert.equal(requests, 3, 'Never request the external redirect target');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
