import test from "node:test";
import assert from "node:assert/strict";
import { extractPptx } from "../lms-agent/src/browser/presentation.js";
import { createMoodleTools } from "../desktop/moodle-tools.mjs";
import { createStore } from "../desktop/store.mjs";
import { createAssistant } from "../desktop/ai.mjs";
import { deckParts, zip } from "./fixtures/pptx.mjs";

test("PPTX extraction follows presentation order and reads split runs, tables, Unicode and notes", async () => {
  const result = await extractPptx(zip(deckParts()));
  assert.equal(result.totalSlides, 2);
  assert.equal(result.slides[0].number, 1);
  assert.equal(result.slides[0].title, "Objects & classes");
  assert.match(result.slides[0].text, /Homework: solve 1–5\nКыргызча/);
  assert.equal(result.slides[0].notes, "Discuss encapsulation <carefully>.");
  assert.equal(result.slides[1].text, "");
  assert.equal(result.slides[1].hidden, true);
  assert.equal(result.slides[1].pictures, 1);
  assert.match(result.limitations, /not visually interpreted/);
});

test("damaged, encrypted/legacy, missing-slide and unsafe XML presentations fail clearly", async () => {
  await assert.rejects(extractPptx(Buffer.from("not a ZIP")), /not a readable PPTX/);
  await assert.rejects(extractPptx(zip({ "folder/lecture.pptx": "content" })), /individual .pptx/);
  const missing = deckParts(); delete missing["ppt/slides/slide10.xml"];
  await assert.rejects(extractPptx(zip(missing)), /missing/);
  const unsafe = deckParts(); unsafe["ppt/slides/slide10.xml"] = '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///secret">]><a>&x;</a>';
  await assert.rejects(extractPptx(zip(unsafe)), /DTD\/entities/);
  const malformed = deckParts(); malformed["ppt/slides/slide10.xml"] = "<unclosed>";
  await assert.rejects(extractPptx(zip(malformed)), /XML is malformed/);
  const bomb = deckParts(); bomb["ppt/slides/slide10.xml"] = "x".repeat(4 * 1024 * 1024 + 1);
  await assert.rejects(extractPptx(zip(bomb)), /safe limits/);
});

test("slide tools require discovered files, reject ZIP folders, paginate/cache decks and return citable evidence", async () => {
  const store = createStore(":memory:"); const sources = []; let slideReads = 0;
  const folder = { id: "activity:30", activityId: "30", title: "Lectures", type: "folder", sourceUrl: "https://ucasaslms.org/mod/folder/view.php?id=30" };
  const file = { id: "attachment:pptx", activityId: "30", title: "Lecture.pptx", filename: "Lecture.pptx", type: "folder_file", sourceUrl: folder.sourceUrl };
  const execute = createMoodleTools({ store, sources, read: async (operation, args) => {
    if (operation === "courses") return [{ id: "10", name: "Course", url: "https://ucasaslms.org/course/view.php?id=10" }];
    if (operation === "files") return { files: args.activityId ? [folder, file] : [folder] };
    if (operation === "read-slides") { slideReads++; return { file: { filename: "Lecture.pptx", path: "/private/Lecture.pptx", bytes: 500 }, presentation: await extractPptx(zip(deckParts())) }; }
    throw Error("Unexpected operation");
  } });
  const call = (name, args = {}) => execute({ name, arguments: JSON.stringify(args) });
  const request = { course_id: "10", file_id: file.id, start_slide: 1, max_slides: 1 };
  try {
    assert.ok((await call("read_slides", request)).error);
    await call("list_courses");
    await call("list_files", { course_id: "10", activity_id: null });
    assert.ok((await call("read_slides", request)).error, "An unopened folder does not expose its files");
    await call("list_files", { course_id: "10", activity_id: "30" });
    assert.match((await call("read_slides", { ...request, file_id: folder.id })).error, /folder ZIP/);
    assert.ok((await call("read_slides", { ...request, start_slide: 0 })).error);
    const first = await call("read_slides", request);
    assert.equal(first.slides[0].reference, "F1");
    assert.match(first.slides[0].text, /Homework/);
    assert.equal(first.next_slide, 2);
    assert.ok(!JSON.stringify(first).includes("/private/"));
    const second = await call("read_slides", { ...request, start_slide: 2 });
    assert.equal(second.slides[0].reference, "F2");
    assert.equal(second.slides[0].image_count, 1);
    assert.equal(second.next_slide, null);
    assert.equal(slideReads, 1);
    assert.equal(store.snapshot().downloads.length, 1);
    assert.equal(sources[0].sourceUrl, folder.sourceUrl);
    assert.match(sources[0].title, /slide 1/);
    assert.equal((await call("read_slides", request)).slides[0].reference, "F1");
    assert.equal(sources.length, 2);
    assert.ok((await call("read_slides", { ...request, start_slide: 100 })).error);
  } finally { store.close(); }
});

test("the assistant can open a lecture folder, read a deck and persist an answer citing slide evidence", async () => {
  const store = createStore(":memory:"); let round = 0;
  const file = { id: "attachment:pptx", activityId: "30", title: "Lecture.pptx", type: "folder_file", sourceUrl: "https://ucasaslms.org/mod/folder/view.php?id=30" };
  const steps = [["list_courses", {}], ["list_files", { course_id: "10", activity_id: null }], ["list_files", { course_id: "10", activity_id: "30" }], ["read_slides", { course_id: "10", file_id: file.id, start_slide: 1, max_slides: 20 }]];
  const assistant = createAssistant({ store, vault: { read: () => "fixture" }, readMoodle: async (operation, args) => {
    if (operation === "courses") return [{ id: "10", name: "Course", url: "https://ucasaslms.org/course/view.php?id=10" }];
    if (operation === "files") return { files: args.activityId ? [file] : [{ ...file, id: "activity:30", type: "folder", title: "Lectures" }] };
    return { file: { filename: "Lecture.pptx", path: "/local/Lecture.pptx", bytes: 200 }, presentation: await extractPptx(zip(deckParts())) };
  }, request: async options => {
    assert.match(options.instructions, /You can read PPTX text and speaker notes/);
    assert.ok(options.tools.some(tool => tool.name === "read_slides"));
    if (round < steps.length) { const [name, args] = steps[round++]; return { output: [{ type: "function_call", call_id: `call-${round}`, name, arguments: JSON.stringify(args) }] }; }
    assert.match(options.messages.at(-1).output, /Homework: solve/);
    return { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ answer: "The slides assign exercises 1–5 [F1].", sourceIds: ["F1"], questions: [] }) }] }] };
  } });
  try {
    const result = await assistant.send({ prompt: "Find the homework in my lecture slides.", mode: "chat", includeTasks: false, documentIds: [] });
    assert.equal(result.messages[1].sources[0].reference, "F1");
    assert.match(result.messages[1].sources[0].excerpt, /solve 1–5/);
    assert.equal(result.downloads.length, 1);
  } finally { store.close(); }
});
