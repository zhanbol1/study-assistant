import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractDetailDom, deadlineDetails } from "../lms-agent/src/browser/deadlines.js";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, "lms-agent/.playwright-browsers");
const { chromium } = await import("../lms-agent/node_modules/playwright/index.mjs");
const { normalizeActivities } = await import("../lms-agent/src/browser/activities.js");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<main id="region-main"><div id="intro"><p>Review differentiation.</p></div>
    <div class="submissionstatustable"><table><tr><th>Due date</th><td>Friday, 23 October 2026, 11:59 PM</td></tr><tr><th>Cut-off date</th><td>30 October 2026, 18:00</td></tr></table></div></main>`);
  let detail = await page.evaluate(extractDetailDom);
  assert.equal(detail.description, "Review differentiation.");
  assert.equal(deadlineDetails(detail.entries, "Asia/Bishkek").dueAt, "2026-10-23T17:59:00.000Z");
  await page.setContent(`<main id="region-main"><div data-region="activity-dates">
    <div><strong>Opens:</strong> <time datetime="2026-10-23T09:00:00+06:00">Friday morning</time></div>
    <div><strong>Closes:</strong> <span data-timestamp="1792756800">Friday afternoon</span></div></div></main>`);
  detail = await page.evaluate(extractDetailDom);
  const quiz = deadlineDetails(detail.entries, "Asia/Bishkek");
  assert.equal(quiz.opensAt, "2026-10-23T03:00:00.000Z");
  assert.equal(quiz.dueAt, new Date(1792756800000).toISOString());
  await page.setContent('<main id="region-main"><div class="activity-dates"><div><strong>Due:</strong> Tomorrow</div></div></main>');
  assert.equal(deadlineDetails((await page.evaluate(extractDetailDom)).entries, "UTC").dueAt, "");
  const activities = normalizeActivities([{ href: "https://ucasaslms.org/mod/quiz/view.php?id=2&sesskey=private", title: "Final exam Quiz" }, { href: "https://evil.example/mod/assign/view.php?id=3", title: "Bad" }]);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].type, "quiz");
  assert.ok(!activities[0].url.includes("private"));
  console.log("Coursework browser fixtures passed: assignment due date, quiz windows, machine timestamps, source sanitization, and unknown-date handling.");
} finally { await browser.close(); }
