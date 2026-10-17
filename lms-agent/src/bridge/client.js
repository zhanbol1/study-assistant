import { readBridgeToken } from './token.js';

const operation = process.argv[2] || 'health';
const argument = process.argv[3];
const secondArgument = process.argv[4];
const paths = new Map([
  ['health', '/health'],
  ['courses', '/v1/courses'],
]);

if (operation === 'assignments' && /^\d+$/.test(argument || '')) {
  paths.set('assignments', `/v1/courses/${argument}/assignments`);
}
if (operation === 'activities' && /^\d+$/.test(argument || '')) {
  paths.set('activities', `/v1/courses/${argument}/activities`);
}
if (operation === 'download' && /^\d+$/.test(argument || '') && /^\d+$/.test(secondArgument || '')) {
  paths.set('download', `/v1/courses/${argument}/activities/${secondArgument}/download`);
}

if (!paths.has(operation)) {
  console.error(JSON.stringify({ ok: false, error: 'Unknown bridge operation.' }));
  process.exit(2);
}

try {
  const token = await readBridgeToken();
  const response = await fetch(`http://127.0.0.1:43127${paths.get(operation)}`, {
    method: operation === 'download' ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  process.stdout.write(`${text}\n`);
  if (!response.ok) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({
    ok: false,
    error: 'The local LMS bridge is not running or its token is unavailable.',
  }));
  process.exitCode = 1;
}
