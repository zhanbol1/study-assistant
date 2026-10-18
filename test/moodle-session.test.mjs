import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMoodleClient } from '../desktop/moodle-client.mjs';
import { createReusableSession } from '../lms-agent/src/browser/reusable-session.js';

function fixtureWorker() {
  const child = new EventEmitter();
  child.requests = [];
  child.postMessage = data => { child.requests.push(data); if (data.operation === 'shutdown') queueMicrotask(() => child.emit('exit')); };
  child.kill = () => child.emit('exit');
  queueMicrotask(() => child.emit('spawn'));
  return child;
}
const next = () => new Promise(resolve => setImmediate(resolve));

test('sequential Moodle reads reuse one worker; abort retires it and ignores late replies', async () => {
  const children = [];
  const client = createMoodleClient({ spawn: () => { const child = fixtureWorker(); children.push(child); return child; } });
  try {
    let result = client.read({ operation: 'courses' });
    await next();
    children[0].emit('message', { id: children[0].requests[0].id, ok: true, result: ['course'] });
    assert.deepEqual(await result, ['course']);
    result = client.read({ operation: 'files' });
    assert.equal(children.length, 1);
    children[0].emit('message', { id: children[0].requests[1].id, ok: true, result: ['file'] });
    assert.deepEqual(await result, ['file']);
    const controller = new AbortController();
    result = client.read({ operation: 'download' }, { signal: controller.signal });
    controller.abort();
    await assert.rejects(result, /stopped/);
    const resumed = client.read({ operation: 'courses' });
    await next();
    assert.equal(children.length, 2);
    children[0].emit('message', { id: children[1].requests[0].id, ok: true, result: ['stale'] });
    children[1].emit('message', { id: children[1].requests[0].id, ok: true, result: ['fresh'] });
    assert.deepEqual(await resumed, ['fresh']);
  } finally { client.close(); }
});

test('worker failure and timeout reject pending work; idle sessions close', async () => {
  const children = [];
  const client = createMoodleClient({ spawn: () => { const child = fixtureWorker(); children.push(child); return child; }, idleMs: 10, timeoutMs: 50 });
  try {
    let result = client.read({ operation: 'courses' }); await next();
    children[0].emit('error', new Error('fixture'));
    await assert.rejects(result, /stopped/);
    await assert.rejects(client.read({ operation: 'courses' }), /timed out/);
    result = client.read({ operation: 'courses' }); await next();
    children[2].emit('message', { id: children[2].requests[0].id, ok: true, result: [] });
    await result;
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(children[2].requests.at(-1).operation, 'shutdown');
  } finally { client.close(); }
});

test('browser cookies survive reads but changed, removed or failed credentials discard the session', async () => {
  let password = 'first', launches = 0, closes = 0, contexts = 0;
  const credentialObjects = [];
  const session = createReusableSession({
    getCredential: async () => { if (!password) throw new Error('No LMS credentials'); const value = { username: 'fixture', password }; credentialObjects.push(value); return value; },
    launch: async () => {
      launches++;
      return { isConnected: () => true, close: async () => { closes++; }, newContext: async () => {
        contexts++;
        return { signedIn: false, newPage: async () => ({ close: async () => {} }) };
      } };
    },
    authenticate: async (_page, _destination, { getCredential }) => { const credential = await getCredential(); assert.equal(credential.password, password); },
  });
  try {
    await session.run('course', async (_page, context) => { context.signedIn = true; });
    await session.run('folder', async (_page, context) => assert.equal(context.signedIn, true));
    assert.equal(launches, 1); assert.equal(contexts, 1);
    password = 'changed';
    await session.run('course', async (_page, context) => assert.equal(context.signedIn, false));
    assert.equal(launches, 2); assert.equal(closes, 1);
    password = '';
    await assert.rejects(session.run('course', async () => {}), /No LMS credentials/);
    assert.equal(closes, 2);
    password = 'restored';
    await assert.rejects(session.run('course', async () => { throw new Error('read failed'); }), /read failed/);
    assert.equal(closes, 3);
    assert.ok(credentialObjects.every(value => value.password === '' && value.username === ''));
  } finally { await session.close(); }
});
