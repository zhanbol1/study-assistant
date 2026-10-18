import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../desktop/store.mjs";
import { createMoodleTools } from "../desktop/moodle-tools.mjs";
import { createAssistant, requestOpenAI } from "../desktop/ai.mjs";

const courses = [{ id: "10", name: "Calculus", url: "https://ucasaslms.org/course/view.php?id=10" }];
const assignments = [{ id: "20", title: "Problem set", kind: "homework", url: "https://ucasaslms.org/mod/assign/view.php?id=20", detailsRead: true, description: "Exercises 1–5", dueAt: "2026-11-01T12:00:00Z" }, { id: "21", title: "Quiz", kind: "quiz", url: "https://ucasaslms.org/mod/quiz/view.php?id=21", detailsRead: false }];
const call = (name, args = {}, call_id = name) => ({ type: "function_call", name, arguments: JSON.stringify(args), call_id });
const final = (sourceIds = []) => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ answer: "Your coursework is listed here.", sourceIds, questions: [] }) }] }] });
const input = { prompt: "What is my homework?", mode: "chat", documentIds: [], includeTasks: false };
const vault = { read: () => "fixture-key", configured: () => true };

test("Moodle tools restrict names, arguments and course IDs to fresh discovery; reads are cached only within a turn", async () => {
  const store = createStore(":memory:");
  const sources = [], reads = [];
  const read = async (operation, id) => { reads.push([operation, id]); return operation === "courses" ? courses : { assignments }; };
  const execute = createMoodleTools({ read, store, sources });
  try {
    assert.match((await execute(call("get_coursework", { course_id: "10", kind: "all" }))).error, /list_courses/);
    assert.match((await execute(call("delete_course"))).error, /Unknown/);
    assert.ok((await execute({ ...call("list_courses"), namespace: "other" })).error);
    assert.ok((await execute({ ...call("list_courses"), arguments: "{" })).error);
    assert.ok((await execute(call("list_courses", { url: "https://evil.test" }))).error);
    assert.equal(reads.length, 0);
    await execute(call("list_courses"));
    await execute(call("list_courses"));
    assert.ok((await execute(call("get_coursework", { course_id: "999", kind: "all" }))).error);
    const homework = await execute(call("get_coursework", { course_id: "10", kind: "homework" }));
    const quizzes = await execute(call("get_coursework", { course_id: "10", kind: "quiz" }));
    assert.equal(homework.items.length, 1);
    assert.equal(quizzes.items[0].dueAt, null);
    assert.equal(quizzes.items[0].detailsRead, false);
    assert.equal(reads.length, 2);
    assert.equal(sources.length, 3);
    assert.equal(sources[0].sourceUrl, assignments[0].url);
    const next = createMoodleTools({ read, store, sources: [] });
    assert.ok((await next(call("get_coursework", { course_id: "10", kind: "all" }))).error);
    await next(call("list_courses"));
    await next(call("get_coursework", { course_id: "10", kind: "all" }));
    assert.equal(reads.length, 4);
  } finally { store.close(); }
});

test("tool loop replays reasoning and call IDs, runs Moodle sequentially and saves cited source links", async () => {
  const store = createStore(":memory:");
  let round = 0, running = false;
  const progress = [];
  const assistant = createAssistant({ store, vault, progress: value => progress.push(value), readMoodle: async operation => {
    assert.equal(running, false); running = true; await Promise.resolve(); running = false;
    return operation === "courses" ? courses : { assignments };
  }, request: async request => {
    if (round++ === 0) return { output: [{ type: "reasoning", id: "rs_fixture", encrypted_content: "encrypted" }, call("list_courses")] };
    if (round === 2) {
      assert.equal(request.messages[1].type, "reasoning");
      const output = request.messages.at(-1);
      assert.equal(output.call_id, "list_courses");
      assert.equal(JSON.parse(output.output).courses[0].id, "10");
      return { output: [call("get_coursework", { course_id: "10", kind: "all" })] };
    }
    assert.equal(JSON.parse(request.messages.at(-1).output).items[0].reference, "M1");
    return final(["M1"]);
  } });
  try {
    const result = await assistant.send(input);
    assert.equal(round, 3);
    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[1].sources[0].sourceUrl, assignments[0].url);
    assert.ok(progress.includes("Reading Calculus"));
    assert.equal(progress.at(-1), "");
  } finally { store.close(); }
});

test("failed reads are returned as errors, never as an empty or stale coursework result", async () => {
  const store = createStore(":memory:");
  store.cacheCourses(courses); store.cacheAssignments("10", { assignments });
  const execute = createMoodleTools({ store, sources: [], read: async operation => { if (operation === "courses") return courses; throw new Error("Moodle login failed."); } });
  try {
    await execute(call("list_courses"));
    const result = await execute(call("get_coursework", { course_id: "10", kind: "all" }));
    assert.match(result.error, /login failed/);
    assert.equal(result.items, undefined);
  } finally { store.close(); }
});

test("cancellation interrupts a Moodle operation and prevents message persistence", async () => {
  const store = createStore(":memory:");
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const assistant = createAssistant({ store, vault, request: async () => ({ output: [call("list_courses")] }), readMoodle: (_operation, _id, _background, signal) => new Promise((_resolve, reject) => { started(); signal.addEventListener("abort", () => reject(signal.reason), { once: true }); }) });
  try {
    const pending = assistant.send(input);
    await ready; assistant.cancel();
    await assert.rejects(pending, /cancelled/);
    assert.equal(store.snapshot().messages.length, 0);
  } finally { store.close(); }
});

test("runaway or malformed tool calls cannot persist partial answers", async () => {
  const store = createStore(":memory:");
  try {
    const assistant = createAssistant({ store, vault, readMoodle: async () => courses, request: async () => ({ output: Array.from({ length: 25 }, (_, index) => call("list_courses", {}, String(index))) }) });
    await assert.rejects(assistant.send(input), /lookup limit/);
    const malformed = createAssistant({ store, vault, readMoodle: async () => courses, request: async () => ({ output: [{ type: "function_call", name: "list_courses" }] }) });
    await assert.rejects(malformed.send(input), /invalid Moodle tool call/);
    assert.equal(store.snapshot().messages.length, 0);
  } finally { store.close(); }
});

test("subscription transport declares namespaced functions and recovers streamed calls with empty terminal output", async () => {
  const events = [
    { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", namespace: "moodle", name: "list_courses", arguments: "" } },
    { type: "response.function_call_arguments.delta", output_index: 0, delta: "{" },
    { type: "response.function_call_arguments.delta", output_index: 0, delta: "}" },
    { type: "response.completed", response: { status: "completed", output: [] } },
  ];
  const result = await requestOpenAI({ subscription: true, tools: [{ type: "function", name: "list_courses" }], fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.tools[0].type, "namespace");
    assert.equal(body.tools[0].name, "moodle");
    assert.equal(body.max_output_tokens, undefined);
    assert.deepEqual(body.include, ["reasoning.encrypted_content"]);
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
  } });
  assert.equal(result.output[0].arguments, "{}");
  assert.equal(result.output[0].call_id, "call_1");
  assert.equal(result.output[0].content, undefined);
  assert.equal(result.output[0].role, undefined, "Function calls must not inherit assistant message fields on replay");
});
