import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore } from "../desktop/store.mjs";
import { createWorkspaceTools } from "../desktop/workspace-tools.mjs";
import { createAssistant, requestOpenAI } from "../desktop/ai.mjs";
import { createMoodleTools } from "../desktop/moodle-tools.mjs";
import { managedDownload } from "../desktop/downloads.mjs";
import { completionDetails } from "../lms-agent/src/browser/completion.js";
import { normalizeFileLinks, safeDownloadName } from "../lms-agent/src/browser/files.js";

const call = (name, args = {}) => ({ name, arguments: JSON.stringify(args), call_id: name, type: "function_call" });
const courses = [{ id: "10", name: "Course", url: "https://ucasaslms.org/course/view.php?id=10" }];

test("memory.md survives restart, respects external edits and rejects stale editor saves", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "study-memory-"));
  let store;
  try {
    store = createStore(path.join(dir, "study.sqlite"));
    const initial = store.snapshot().memory;
    assert.ok(fs.existsSync(path.join(dir, "memory.md")));
    store.saveMemory("# My rules\nCheck calculus first.", initial.revision);
    store.close(); store = createStore(path.join(dir, "study.sqlite"));
    assert.match(store.snapshot().memory.content, /calculus/);
    const saved = store.snapshot().memory;
    fs.writeFileSync(path.join(dir, "memory.md"), "Edited in my text editor.");
    assert.equal(store.snapshot().memory.content, "Edited in my text editor.");
    assert.throws(() => store.saveMemory("Stale draft", saved.revision), /changed elsewhere/);
    assert.throws(() => store.saveMemory("x".repeat(20001), store.snapshot().memory.revision), /20,000/);
    assert.equal(fs.readFileSync(path.join(dir, "memory.md"), "utf8"), "Edited in my text editor.");
  } finally { store?.close(); fs.rmSync(dir, { recursive: true }); }
});

test("saved pages persist, protect concurrent edits, validate sources and delete by revision", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "study-pages-"));
  let store;
  try {
    store = createStore(path.join(dir, "study.sqlite"));
    const page = store.savePage({ title: "Homework", content: "Review chapter 2.", sources: [] });
    store.close(); store = createStore(path.join(dir, "study.sqlite"));
    assert.equal(store.snapshot().pages[0].id, page.id);
    const updated = store.savePage({ id: page.id, revision: page.revision, title: "Homework", content: "Updated" });
    assert.throws(() => store.savePage({ id: page.id, revision: page.revision, title: "Old", content: "Overwrite" }), /changed/);
    assert.throws(() => store.deletePage(page.id, page.revision), /changed/);
    assert.throws(() => store.savePage({ title: "Bad", content: "x", sources: [{ reference: "S1", title: "Evil", sourceUrl: "https://example.com" }] }));
    store.deletePage(page.id, updated.revision);
    assert.equal(store.snapshot().pages.length, 0);
  } finally { store?.close(); fs.rmSync(dir, { recursive: true }); }
});

test("workspace tools require known pages and sources, keep Memory user-owned and remap historical citations", async () => {
  const store = createStore(":memory:"); const sources = [];
  let execute = createWorkspaceTools({ store, sources });
  try {
    const args = { id: null, revision: null, title: "Overview", content: "Saved overview", source_ids: [] };
    assert.ok((await execute(call("save_page", { ...args, source_ids: ["invented"] }))).error);
    const saved = await execute(call("save_page", args));
    assert.equal(saved.saved, true);
    execute = createWorkspaceTools({ store, sources });
    assert.ok((await execute(call("save_page", { ...args, id: saved.id, revision: saved.revision }))).error);
    await execute(call("read_page", { id: saved.id }));
    assert.equal((await execute(call("save_page", { ...args, id: saved.id, revision: saved.revision, content: "Changed" }))).saved, true);
    assert.ok((await execute(call("save_memory", { content: "overwrite" }))).error);
    assert.ok((await execute({ ...call("list_pages"), namespace: "moodle" })).error);
    const page = store.savePage({ title: "Cited", content: "Old facts [M1]", sources: [{ reference: "M1", title: "Course", sourceUrl: courses[0].url }] });
    const read = await execute(call("read_page", { id: page.id }));
    assert.equal(read.sources[0].reference, "P1");
    assert.equal(sources[0].reference, "P1");
    assert.match(sources[0].content, /Historical/);
  } finally { store.close(); }
});

test("the assistant receives saved Memory and can save a page through multiple provider rounds without Moodle", async () => {
  const store = createStore(":memory:"); let round = 0;
  store.saveMemory("Always check the optional tutorial sheet.", store.snapshot().memory.revision);
  const assistant = createAssistant({ store, vault: { read: () => "fixture" }, request: async request => {
    assert.match(request.instructions, /optional tutorial sheet/);
    assert.ok(request.tools.some(tool => tool.name === "save_page"));
    if (round++ === 0) return { output: [{ ...call("save_page", { id: null, revision: null, title: "Overview", content: "My study plan", source_ids: [] }), namespace: "workspace" }] };
    assert.equal(JSON.parse(request.messages.at(-1).output).saved, true);
    return { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ answer: "Saved your Overview page.", sourceIds: [], questions: [] }) }] }] };
  } });
  try {
    const result = await assistant.send({ prompt: "Create and save an Overview page.", mode: "chat", includeTasks: false, documentIds: [] });
    assert.equal(result.pages[0].title, "Overview");
    assert.equal(result.messages.length, 2);
  } finally { store.close(); }
});

test("subscription and API transports group tools without sending custom namespace metadata inside functions", async () => {
  for (const subscription of [false, true]) {
    await requestOpenAI({ subscription, tools: [{ type: "function", name: "list_courses" }, { namespace: "workspace", type: "function", name: "list_pages" }], fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (subscription) { assert.deepEqual(body.tools.map(tool => tool.name), ["moodle", "workspace"]); assert.equal(body.tools[1].tools[0].namespace, undefined); }
      else { assert.deepEqual(body.tools.map(tool => tool.name), ["list_courses", "list_pages"]); assert.equal(body.tools[1].namespace, undefined); }
      const completed = { status: "completed", output: [] };
      return subscription ? new Response(`data: ${JSON.stringify({ type: "response.completed", response: completed })}\n\n`) : new Response(JSON.stringify(completed));
    } });
  }
});

test("long tool runs recheck credentials between provider requests", async () => {
  const store = createStore(":memory:"); let credentials = 0, requests = 0;
  const assistant = createAssistant({ store, credentials: async () => ({ key: `renewed-${++credentials}` }), request: async options => {
    assert.equal(options.key, `renewed-${++requests}`);
    if (requests === 1) return { output: [{ ...call("list_pages"), namespace: "workspace" }] };
    return { output: [{ type: "message", content: [{ type: "output_text", text: '{"answer":"No pages saved yet.","sourceIds":[],"questions":[]}' }] }] };
  } });
  try {
    await assistant.send({ prompt: "List my saved pages.", mode: "chat", includeTasks: false, documentIds: [] });
    assert.equal(credentials, 2);
  } finally { store.close(); }
});

test("Moodle downloads require discovered files, retain metadata, deduplicate within a turn and never expose local paths to AI", async () => {
  const store = createStore(":memory:"); let downloads = 0;
  const execute = createMoodleTools({ store, sources: [], read: async operation => {
    if (operation === "courses") return courses;
    if (operation === "files") return { files: [{ id: "activity:30", activityId: "30", title: "Lecture", type: "resource", sourceUrl: "https://ucasaslms.org/mod/resource/view.php?id=30" }] };
    downloads++; return { file: { filename: "lecture.pdf", path: "/private/path/lecture.pdf", bytes: 100 } };
  } });
  try {
    assert.ok((await execute(call("download_file", { course_id: "10", file_id: "activity:30" }))).error);
    await execute(call("list_courses"));
    assert.ok((await execute(call("download_file", { course_id: "10", file_id: "activity:30" }))).error);
    await execute(call("list_files", { course_id: "10", activity_id: null }));
    const result = await execute(call("download_file", { course_id: "10", file_id: "activity:30" }));
    assert.equal(result.downloaded, true); assert.equal(result.contentsRead, false);
    assert.ok(!JSON.stringify(result).includes("private/path"));
    await execute(call("download_file", { course_id: "10", file_id: "activity:30" }));
    assert.equal(downloads, 1);
    assert.equal(store.snapshot().downloads.length, 1);
    assert.equal(store.snapshot().downloads[0].path, undefined);
  } finally { store.close(); }
});

test("attachment discovery excludes external and arbitrary links and download filenames stay in their folder", () => {
  const activity = { id: "20", url: "https://ucasaslms.org/mod/assign/view.php?id=20" };
  const links = normalizeFileLinks([{ href: "https://ucasaslms.org/pluginfile.php/12/mod_assign/intro/a.pdf?token=secret", title: "Sheet" }, { href: "https://evil.test/pluginfile.php/12/a.pdf" }, { href: "https://ucasaslms.org/admin/delete.php" }, { href: "https://x:y@ucasaslms.org/pluginfile.php/12/a.pdf" }], activity);
  assert.equal(links.length, 1); assert.ok(!links[0].url.includes("secret"));
  const name = safeDownloadName('../../evil:thing.pdf', "20", "fixture");
  assert.equal(path.basename(name), name); assert.ok(!/[\\/:]/.test(name));
});

test("download reveal resolves only existing files within the managed folder", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "study-download-"));
  try {
    fs.mkdirSync(path.join(dir, "downloads")); fs.writeFileSync(path.join(dir, "downloads/a.pdf"), "fixture"); fs.writeFileSync(path.join(dir, "outside.pdf"), "outside");
    assert.equal(managedDownload(path.join(dir, "downloads/a.pdf"), path.join(dir, "downloads")), fs.realpathSync(path.join(dir, "downloads/a.pdf")));
    assert.throws(() => managedDownload(path.join(dir, "outside.pdf"), path.join(dir, "downloads")), /outside/);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test("completion evidence distinguishes submissions, drafts, quiz attempts and unknown without inferring from dates", () => {
  assert.equal(completionDetails([{ label: "Submission status", value: "Submitted for grading" }]).submissionStatus, "submitted");
  assert.equal(completionDetails([{ label: "Submission status", value: "Draft (not submitted)" }]).submissionStatus, "not_submitted");
  assert.equal(completionDetails([{ label: "Submission status", value: "Draft saved" }]).submissionStatus, "draft");
  assert.equal(completionDetails([{ label: "Due date", value: "Yesterday" }]).submissionStatus, "unknown");
  assert.equal(completionDetails([], ["Finished"]).submissionStatus, "attempt_finished");
  assert.equal(completionDetails([], ["Finished", "In progress"]).submissionStatus, "in_progress");
});
