import crypto from 'node:crypto';
import http from 'node:http';
import { listCourses } from '../browser/courses.js';
import { listAssignments } from '../browser/assignments.js';
import { downloadActivity, listActivities } from '../browser/activities.js';
import { ensureBridgeToken, tokenPath } from './token.js';

const host = '127.0.0.1';
const port = 43127;
const token = await ensureBridgeToken();

const server = http.createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');

  if (!isAuthorized(request, token)) {
    response.writeHead(401);
    response.end(JSON.stringify({ ok: false, error: 'Unauthorized.' }));
    return;
  }

  try {
    if (request.method === 'GET' && request.url === '/health') {
      response.end(JSON.stringify({ ok: true, service: 'uca-lms-agent', mode: 'read-only' }));
      return;
    }
    if (request.method === 'GET' && request.url === '/v1/courses') {
      const courses = await listCourses();
      response.end(JSON.stringify({ ok: true, courses }));
      return;
    }
    const assignmentMatch = request.method === 'GET'
      && request.url?.match(/^\/v1\/courses\/(\d+)\/assignments$/);
    if (assignmentMatch) {
      const result = await listAssignments(assignmentMatch[1]);
      response.end(JSON.stringify({ ok: true, ...result }));
      return;
    }
    const activitiesMatch = request.method === 'GET'
      && request.url?.match(/^\/v1\/courses\/(\d+)\/activities$/);
    if (activitiesMatch) {
      const result = await listActivities(activitiesMatch[1]);
      response.end(JSON.stringify({ ok: true, ...result }));
      return;
    }
    const downloadMatch = request.method === 'POST'
      && request.url?.match(/^\/v1\/courses\/(\d+)\/activities\/(\d+)\/download$/);
    if (downloadMatch) {
      const result = await downloadActivity(downloadMatch[1], downloadMatch[2]);
      response.end(JSON.stringify({ ok: true, ...result }));
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ ok: false, error: 'Unknown read-only operation.' }));
  } catch (error) {
    response.writeHead(500);
    response.end(JSON.stringify({ ok: false, error: error.message }));
  }
});

server.listen(port, host, () => {
  console.log(`UCA LMS read-only bridge listening on http://${host}:${port}`);
  console.log(`Authorization token loaded from ${tokenPath}`);
  console.log('Keep this terminal open. Press Ctrl+C to stop.');
});

function isAuthorized(request, expectedToken) {
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  const expected = Buffer.from(expectedToken);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
