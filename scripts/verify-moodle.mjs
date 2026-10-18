// Live, read-only verification. Prints counts only, never course names, credentials, or page contents.
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, "lms-agent/.playwright-browsers");
process.env.LMS_HEADLESS = "true";
const { getLmsCredential } = await import("../lms-agent/src/security/credential-store.js");
try {
  const credential = await getLmsCredential();
  credential.username = ""; credential.password = "";
} catch {
  console.error("Live Moodle verification requires credentials accessible to this Windows account. Run npm run credentials:set in your terminal, then npm run test:moodle:live.");
  process.exit(2);
}
try {
  const { listCourses } = await import("../lms-agent/src/browser/courses.js");
  const { listCoursework } = await import("../lms-agent/src/browser/coursework.js");
  const courses = await listCourses();
  assert.ok(courses.length, "No visible courses");
  let items = 0; let dates = 0; let unreadable = 0; let checked = 0; let representative = 0;
  for (const course of courses.slice(0, 8)) {
    const result = await listCoursework(course.id);
    checked++;
    console.log(`Course ${checked}: ${result.activityCount} visible module links; ${result.assignments.length} assignment/quiz items.`);
    if (result.assignments.length) representative++;
    items += result.assignments.length;
    dates += result.assignments.filter(item => item.dueAt).length;
    unreadable += result.assignments.filter(item => !item.detailsRead).length;
    if (representative >= 2) break;
  }
  console.log(`Live Moodle: ${courses.length} visible courses; checked ${checked} courses; ${items} coursework items; ${dates} explicit deadlines; ${unreadable} unreadable detail pages.`);
  if (!items || unreadable) process.exitCode = 1;
} catch {
  console.error("Live Moodle verification could not complete. Check the connection and stored credentials; SSO/MFA may require a manual sync in the app.");
  process.exitCode = 1;
}
