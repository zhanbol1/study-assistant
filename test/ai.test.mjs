import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAssistant, createKeyVault, generateOpenAI, retrieveSources, searchDocuments, validateAnswer } from "../desktop/ai.mjs";
import { createStore } from "../desktop/store.mjs";

test("retrieval searches document contents and only shares explicitly selected materials", () => {
  const documents = [{ id: "1", title: "Lecture", content: "x ".repeat(3000) + "The derivative of x squared is twice x." }, { id: "2", title: "Private", content: "Secret material" }];
  const sources = retrieveSources("derivative squared", documents, [{ id: "task", title: "Private task" }], ["1"], false);
  assert.match(sources[0].content, /derivative/);
  assert.ok(sources.every(source => source.id.startsWith("1:")));
  assert.equal(retrieveSources("derivative", documents, [], [], false).length, 0);
  assert.equal(searchDocuments("derivative", documents).length, 1);
  assert.equal(searchDocuments("nonexistent", documents).length, 0);
  assert.throws(() => retrieveSources("x", documents, [], ["missing"]));
});

test("chat persists only successful validated answers, enforces citations and rejects malformed quizzes", async () => {
  const store = createStore(":memory:");
  const requests = [];
  let fail = false;
  const assistant = createAssistant({ store, vault: { configured: () => true, read: () => "test-secret" }, generate: async request => {
    requests.push(request);
    if (fail) throw new Error("Unavailable");
    return { answer: "Use the chain rule.", sourceIds: ["S1"], questions: [] };
  } });
  try {
    store.addDocument({ title: "Lecture", content: "The chain rule composes derivatives." });
    const doc = store.snapshot().documents[0];
    assert.equal(doc.content, undefined, "Snapshots contain material metadata, not full contents");
    const request = { prompt: "Explain the chain rule", mode: "chat", documentIds: [doc.id], includeTasks: false };
    const result = await assistant.send(request);
    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[1].sources[0].title, "Lecture");
    assert.ok(!JSON.stringify(result).includes("test-secret"));
    assert.match(requests[0].messages[0].content, /chain rule/);
    fail = true;
    await assert.rejects(assistant.send(request), /Unavailable/);
    assert.equal(store.snapshot().messages.length, 2);
    assert.throws(() => validateAnswer({ answer: "x", sourceIds: ["invented"], questions: [] }, [], "chat"));
    assert.throws(() => validateAnswer({ answer: "x", sourceIds: [], questions: [{ question: "q", choices: ["a", "b"], answerIndex: 8 }] }, [], "quiz"));
    assert.throws(() => validateAnswer({ answer: "x", sourceIds: [], questions: [] }, [], "quiz"));
    assistant.clear(); assert.equal(store.snapshot().messages.length, 0);
    store.deleteDocument(doc.id); assert.equal(store.documents().length, 0);
  } finally { store.close(); }
});

test("concurrent AI calls and chat deletion cannot race an in-flight response", async () => {
  const store = createStore(":memory:");
  let release;
  const assistant = createAssistant({ store, vault: { read: () => "test-key" }, generate: () => new Promise(resolve => { release = resolve; }) });
  const input = { prompt: "Explain calculus", mode: "chat", documentIds: [], includeTasks: false };
  try {
    const pending = assistant.send(input);
    await assert.rejects(assistant.send(input), /already running/);
    assert.throws(() => assistant.clear(), /Wait/);
    release({ answer: "Calculus studies change.", sourceIds: [], questions: [] });
    await pending;
  } finally { store.close(); }
});

test("OpenAI requests use the documented Responses shape without server storage or redirects", async () => {
  const result = await generateOpenAI({ key: "test-key", model: "test-model", messages: [{ role: "user", content: "hello" }], instructions: "Tutor", fetchImpl: async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.equal(body.model, "test-model");
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(options.redirect, "error");
    return { ok: true, json: async () => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"answer":"Hi","sourceIds":[],"questions":[]}' }] }] }) };
  } });
  assert.equal(result.answer, "Hi");
  await assert.rejects(generateOpenAI({ fetchImpl: async () => ({ ok: false, status: 401 }) }), /key was rejected/);
  await assert.rejects(generateOpenAI({ fetchImpl: async () => { throw new Error("secret provider details"); } }), error => !error.message.includes("secret"));
  await assert.rejects(generateOpenAI({ fetchImpl: async () => ({ ok: true, json: async () => ({ status: "incomplete" }) }) }), /incomplete/);
});

test("API key storage refuses plaintext backends and never exposes keys through status", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "study-vault-"));
  const filename = path.join(folder, "key.bin");
  try {
    const insecure = createKeyVault(filename, { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "basic_text" }, {});
    assert.throws(() => insecure.save("test-key"), /Secure/);
    assert.equal(fs.existsSync(filename), false);
    const encryption = { isEncryptionAvailable: () => true, encryptString: key => Buffer.from(key).map(byte => byte ^ 42), decryptString: buffer => Buffer.from(buffer).map(byte => byte ^ 42).toString() };
    const vault = createKeyVault(filename, encryption, {});
    vault.save("test-key");
    assert.equal(vault.configured(), true);
    assert.ok(!fs.readFileSync(filename).toString().includes("test-key"));
    assert.equal(vault.read(), "test-key");
    vault.remove(); assert.equal(vault.configured(), false);
    const environment = createKeyVault(filename, encryption, { OPENAI_API_KEY: "env-test-key" });
    assert.equal(environment.read(), "env-test-key");
  } finally { fs.rmSync(folder, { recursive: true }); }
});
