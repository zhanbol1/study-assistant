import { subscriptionError } from "./chatgpt-auth.mjs";

export async function readResponseStream(response) {
  if (!response.body) throw new Error("ChatGPT returned an empty response stream.");
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let complete;
  const items = new Map();
  function streamedItem(value) {
    const index = Number.isInteger(value.output_index) && value.output_index >= 0 ? value.output_index : 0;
    if (index > 1000 || items.size > 1000) throw new Error("ChatGPT returned too many response items.");
    if (!items.has(index)) items.set(index, {});
    return items.get(index);
  }
  function partFor(value, type) {
    const item = streamedItem(value);
    item.type ||= "message";
    item.role ||= "assistant";
    const index = Number.isInteger(value.content_index) && value.content_index >= 0 ? value.content_index : 0;
    if (index > 1000) throw new Error("ChatGPT returned too many response parts.");
    item.content ||= [];
    item.content[index] ||= { type, ...(type === "output_text" ? { text: "" } : { refusal: "" }) };
    return item.content[index];
  }
  function event(block) {
    const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    let value;
    try { value = JSON.parse(data); } catch { throw new Error("ChatGPT returned an unreadable stream event."); }
    if (value.type === "response.failed" || value.type === "error") throw subscriptionError(response.status || 200, { error: value.response?.error || value.error || value }, response.headers?.get("x-request-id") || "");
    if (value.type === "response.incomplete") throw new Error("ChatGPT could not complete the answer. Try a shorter request.");
    if (["response.output_item.added", "response.output_item.done"].includes(value.type) && value.item) {
      const item = streamedItem(value);
      const previous = item.content;
      Object.assign(item, value.item);
      if (!item.content?.length && previous?.length) item.content = previous;
    }
    if (["response.content_part.added", "response.content_part.done"].includes(value.type) && value.part) {
      const part = partFor(value, value.part.type);
      Object.assign(part, value.part);
    }
    if (value.type === "response.output_text.delta" && typeof value.delta === "string") partFor(value, "output_text").text += value.delta;
    if (value.type === "response.output_text.done" && typeof value.text === "string") partFor(value, "output_text").text = value.text;
    if (value.type === "response.refusal.delta" && typeof value.delta === "string") partFor(value, "refusal").refusal += value.delta;
    if (value.type === "response.refusal.done" && typeof value.refusal === "string") partFor(value, "refusal").refusal = value.refusal;
    if (value.type === "response.function_call_arguments.delta" && typeof value.delta === "string") {
      const item = streamedItem(value); item.arguments = (item.arguments || "") + value.delta;
    }
    if (value.type === "response.function_call_arguments.done" && typeof value.arguments === "string") streamedItem(value).arguments = value.arguments;
    if (value.type === "response.completed") complete = value.response;
  }
  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 2000000) throw new Error("ChatGPT response exceeded the study answer size limit.");
      buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) { event(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
    }
    buffer += decoder.decode();
    if (buffer.trim()) event(buffer);
  } catch (error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") throw new Error("ChatGPT response timed out. Try again.");
    throw error;
  }
  if (complete?.status !== "completed") throw new Error("ChatGPT stopped before completing the answer. No partial response was saved.");
  // Subscription streams can omit output from the terminal response. Retain
  // their streamed message items, but only after a successful completion event.
  const recovered = [...items.entries()].sort(([a], [b]) => a - b).map(([, item]) => {
    if (item.type !== "message") { delete item.content; delete item.role; }
    return item;
  });
  const output = [...(complete.output || [])];
  for (const [index, item] of recovered.entries()) {
    const match = item.id ? output.findIndex(other => other.id === item.id) : output[index]?.type === item.type ? index : -1;
    if (match < 0) output.push(item);
    else if (item.type === "message" && !output[match].content?.length) output[match] = item;
  }
  return { ...complete, output };
}
