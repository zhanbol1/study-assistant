import { subscriptionError } from "./chatgpt-auth.mjs";

export async function readResponseStream(response) {
  if (!response.body) throw new Error("ChatGPT returned an empty response stream.");
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let complete;
  function event(block) {
    const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    let value;
    try { value = JSON.parse(data); } catch { throw new Error("ChatGPT returned an unreadable stream event."); }
    if (value.type === "response.failed" || value.type === "error") throw subscriptionError(response.status || 200, { error: value.response?.error || value.error || value }, response.headers?.get("x-request-id") || "");
    if (value.type === "response.incomplete") throw new Error("ChatGPT could not complete the answer. Try a shorter request.");
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
  return complete;
}
