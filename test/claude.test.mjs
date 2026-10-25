import test from "node:test";
import assert from "node:assert/strict";
import { claudeTools, runClaude } from "../desktop/claude.mjs";
import { createAssistant } from "../desktop/ai.mjs";
import { createStore } from "../desktop/store.mjs";
import { workspaceFunctions } from "../desktop/workspace-tools.mjs";

const fakeClient = replies => {
  const requests = [];
  return { requests, beta: { messages: { stream: params => {
    requests.push(structuredClone(params));
    return { finalMessage: async () => replies.shift() };
  } } } };
};
const answer = value => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(value) }] });

test("Claude tool loop returns every tool result in one user turn and parses the final answer", async () => {
  const client = fakeClient([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "a", name: "list_pages", input: {} }, { type: "tool_use", id: "b", name: "read_page", input: { id: "x" } }] },
    answer({ answer: "Done.", sourceIds: [], questions: [] }),
  ]);
  const calls = [];
  const result = await runClaude({ client, key: "k", messages: [{ role: "user", content: "hi" }], instructions: "sys", tools: workspaceFunctions,
    execute: async call => { calls.push(call); return call.name === "read_page" ? { error: "Page not found." } : { pages: [] }; } });
  assert.equal(result.answer, "Done.");
  assert.deepEqual(calls.map(call => [call.name, JSON.parse(call.arguments)]), [["list_pages", {}], ["read_page", { id: "x" }]]);
  const second = client.requests[1];
  assert.equal(second.model, "claude-opus-5-5");
  assert.equal(second.fallbacks, "default");
  assert.equal(second.messages.length, 3);
  assert.deepEqual(second.messages[2].content.map(block => [block.tool_use_id, Boolean(block.is_error)]), [["a", false], ["b", true]]);
  assert.ok(!JSON.stringify(second.output_config.format.schema).includes("minItems"));
  assert.ok(second.tools.every(tool => tool.input_schema && !("namespace" in tool) && !("strict" in tool)));
});

test("Claude refusals and cheaper models without fallback are handled", async () => {
  const client = fakeClient([{ stop_reason: "refusal", content: [] }]);
  await assert.rejects(runClaude({ client, model: "claude-haiku-5-5", key: "k", messages: [{ role: "user", content: "hi" }], instructions: "", execute: async () => ({}) }), /declined/);
  assert.equal(client.requests[0].fallbacks, undefined);
  assert.equal(claudeTools([{ name: "n", description: "d", parameters: { type: "object", properties: { n: { type: "integer", minimum: 1 } } } }])[0].input_schema.properties.n.minimum, undefined);
});

test("assistant routes Claude credentials to the Claude loop", async () => {
  const store = createStore(":memory:");
  let received;
  const assistant = createAssistant({ store, vault: { configured: () => true, read: () => "unused" },
    credentials: () => ({ provider: "claude", key: "anthropic-key", model: "claude-sonnet-5-5" }),
    request: () => { throw new Error("OpenAI must not be called"); },
    claude: async options => { received = options; return { answer: "From Claude.", sourceIds: [], questions: [] }; } });
  try {
    const result = await assistant.send({ prompt: "Explain limits", mode: "chat", documentIds: [], includeTasks: false });
    assert.equal(result.messages[1].content, "From Claude.");
    assert.equal(received.key, "anthropic-key");
    assert.equal(received.model, "claude-sonnet-5-5");
    assert.ok(received.tools.some(tool => tool.name === "save_page"));
  } finally { store.close(); }
});
