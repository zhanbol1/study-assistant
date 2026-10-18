import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractDetailDom, deadlineDetails } from "../lms-agent/src/browser/deadlines.js";
import { completionDetails } from "../lms-agent/src/browser/completion.js";

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
  await page.setContent('<main id="region-main"><table class="submissionstatustable"><tr><th>Submission status</th><td>Submitted for grading</td></tr></table><table class="quizattemptsummary"><tr><th>Attempt</th><th>State</th></tr><tr><td>1</td><td>Finished</td></tr></table></main>');
  detail = await page.evaluate(extractDetailDom);
  assert.equal(completionDetails(detail.entries, detail.attemptStates).submissionStatus, "submitted");
  assert.equal(completionDetails([], detail.attemptStates).submissionStatus, "attempt_finished");
  const { filesForActivity } = await import("../lms-agent/src/browser/files.js");
  await page.route("https://ucasaslms.org/**", route => route.fulfill({ contentType: "text/html", body: '<main id="region-main"><div id="intro"><a href="https://ucasaslms.org/pluginfile.php/12/mod_assign/intro/sheet.pdf?token=private">Homework sheet</a><a href="https://evil.test/pluginfile.php/12/a.pdf">External</a></div></main>' }));
  const files = await filesForActivity(page, { id: "22", type: "assign", url: "https://ucasaslms.org/mod/assign/view.php?id=22" });
  assert.equal(files.length, 1); assert.equal(files[0].title, "Homework sheet"); assert.ok(!files[0].url.includes("private"));
  await page.unroute("https://ucasaslms.org/**");
  await page.route("https://ucasaslms.org/**", route => route.fulfill({ contentType: "text/html", body: '<main id="region-main"><div class="foldertree"><ul><li><a href="/pluginfile.php/45/mod_folder/content/0/week1/lecture%201.pptx?forcedownload=1">Lecture 1.pptx</a></li><li><ul><li><a href="/pluginfile.php/45/mod_folder/content/0/week2/lecture2.pptx">Lecture 2.pptx</a></li></ul></li></ul><a href="https://other.test/pluginfile.php/45/evil.pptx">External</a></div></main>' }));
  const folderFiles = await filesForActivity(page, { id: "30", type: "folder", url: "https://ucasaslms.org/mod/folder/view.php?id=30" });
  assert.equal(folderFiles.length, 3);
  assert.equal(folderFiles[0].id, "activity:30", "Folder ZIP remains downloadable");
  assert.equal(folderFiles[1].filename, "lecture 1.pptx");
  assert.equal(folderFiles[2].type, "folder_file");
  console.log("Coursework browser fixtures passed: deadlines, quiz windows, submission and attempt evidence, homework attachment discovery, and source sanitization.");
} finally { await browser.close(); }
