import Anthropic from "@anthropic-ai/sdk";
import { answerSchema } from "./ai.mjs";

export const defaultClaudeModel = "claude-opus-5-5";
// Server-side refusal fallback is accepted only on these models.
const fallbackModels = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

// Structured outputs reject array length limits; validateAnswer enforces them.
function relaxed(schema) {
  if (Array.isArray(schema)) return schema.map(relaxed);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(Object.entries(schema).filter(([key]) => !["minItems", "maxItems", "minimum", "maximum"].includes(key)).map(([key, value]) => [key, relaxed(value)]));
}
export const claudeTools = functions => functions.map(({ name, description, parameters }) => ({ name, description, input_schema: relaxed(parameters) }));

function claudeError(error) {
  if (error instanceof Anthropic.AuthenticationError) return new Error("The Claude API key was rejected. Reconnect in Settings.");
  if (error instanceof Anthropic.PermissionDeniedError) return new Error("Your Anthropic account cannot access this model.");
  if (error instanceof Anthropic.NotFoundError) return new Error("Claude model not found. Check the model ID in Settings.");
  if (error instanceof Anthropic.RateLimitError) return new Error("Claude rate or usage limit reached. Check API billing and try later.");
  if (error instanceof Anthropic.APIConnectionError) return new Error("Claude could not be reached or the request timed out. Try again.");
  if (error instanceof Anthropic.APIError) return new Error(`Claude request failed (HTTP ${error.status ?? "unknown"}). Check your model and connection.`);
  return error;
}

export function parseClaudeAnswer(message) {
  if (message.stop_reason === "refusal") throw new Error("The AI declined this request. Try rephrasing it or asking a different study question.");
  if (message.stop_reason === "max_tokens") throw new Error("The AI response was incomplete. Try a shorter request.");
  const output = message.content.filter(block => block.type === "text").map(block => block.text).join("");
  if (!output.trim()) throw new Error("Claude completed the request without an answer. Try again.");
  try { return JSON.parse(output); }
  catch { throw new Error("The AI did not return a study answer. Try again."); }
}

// Runs the Messages API tool loop. `execute` receives OpenAI-shaped calls
// ({ name, arguments }) so the Moodle and workspace executors stay shared.
export async function runClaude({ key, model = defaultClaudeModel, messages, instructions, tools = [], execute, signal, progress = () => {}, maxCalls = 24, client = new Anthropic({ apiKey: key, maxRetries: 2 }) }) {
  const conversation = messages.map(({ role, content }) => ({ role, content }));
  const fallback = fallbackModels.has(model);
  // Built per call: ai.mjs imports this module, so answerSchema is not ready at load time.
  const schema = relaxed(answerSchema);
  let count = 0;
  for (let round = 0; round < 26; round++) {
    signal?.throwIfAborted();
    progress(round ? "Preparing your answer" : "Thinking");
    let message;
    try {
      message = await client.beta.messages.stream({
        model, max_tokens: 32000, system: instructions, messages: conversation,
        cache_control: { type: "ephemeral" },
        output_config: { effort: "medium", format: { type: "json_schema", schema } },
        ...(tools.length ? { tools: claudeTools(tools) } : {}),
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
      }, { signal }).finalMessage();
    } catch (error) {
      if (signal?.aborted) throw error;
      throw claudeError(error);
    }
    signal?.throwIfAborted();
    const calls = message.content.filter(block => block.type === "tool_use");
    if (message.stop_reason !== "tool_use" || !calls.length) return parseClaudeAnswer(message);
    if (count + calls.length > maxCalls) throw new Error("The assistant reached its Moodle lookup limit. Ask about a specific course to continue.");
    conversation.push({ role: "assistant", content: message.content });
    const results = [];
    for (const call of calls) {
      count++;
      const output = await execute({ name: call.name, arguments: JSON.stringify(call.input ?? {}) });
      results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(output), ...(output?.error ? { is_error: true } : {}) });
    }
    // All results for one assistant turn go back in a single user message.
    conversation.push({ role: "user", content: results });
  }
  throw new Error("The assistant reached its lookup limit. Ask about a specific course to continue.");
}
