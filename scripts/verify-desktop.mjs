// Uses an isolated Electron profile; provider endpoints are mocked.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import fs from "node:fs/promises";
const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const { _electron } = await import("../lms-agent/node_modules/playwright/index.mjs");
const env = { ...process.env, OPENAI_API_KEY: "" }; delete env.ELECTRON_RUN_AS_NODE;
let desktop;
try {
  await fs.rm(path.join(root, ".runtime/desktop-smoke/chatgpt-session.bin"), { force: true });
  desktop = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist", process.platform === "win32" ? "electron.exe" : "electron"), args: [root, "--smoke-test"], env, timeout: 20000 });
  const page = await desktop.firstWindow({ timeout: 15000 }); page.setDefaultTimeout(15000);
  await page.getByLabel("Message", { exact: true }).waitFor();
  assert.equal(await page.getByRole("navigation", { name: "Workspace", exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  await page.evaluate(async () => {
    await window.study.disconnectAi(); await window.study.clearChat();
    await window.study.saveSettings({ aiMode: "api-key" });
    for (const page of (await window.study.snapshot()).pages) await window.study.deletePage(page.id, page.revision);
    for (const doc of (await window.study.snapshot()).documents) await window.study.deleteDocument(doc.id);
  });
  await page.reload();
  const sidebar = page.getByRole("navigation", { name: "Workspace", exact: true });
  await sidebar.getByRole("button", { name: "Memory", exact: true }).click();
  await page.getByLabel("Memory instructions", { exact: true }).fill("Use my course tutorial sheets. Never infer completion from a deadline.");
  await page.getByRole("button", { name: "Save memory", exact: true }).click();
  await page.getByText("Memory saved. Your next message will use these instructions.", { exact: true }).waitFor();
  const memoryDirectory = await desktop.evaluate(({ app }) => app.getPath("userData"));
  const memoryFile = await fs.readFile(path.join(memoryDirectory, "memory.md"), "utf8");
  assert.match(memoryFile, /tutorial sheets/);
  await sidebar.getByRole("button", { name: "Chat", exact: true }).click();
  await page.getByRole("button", { name: "What is my homework?" }).click();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Connect ChatGPT" }).waitFor();
  await page.getByLabel("API key", { exact: true }).fill("desktop-test-key");
  await page.getByRole("button", { name: "Save connection", exact: true }).click();
  await page.getByText(/Connection settings saved/).waitFor();
  assert.equal(await page.getByLabel("API key", { exact: true }).inputValue(), "");
  await desktop.evaluate(() => {
    globalThis.studyRequests = [];
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body); globalThis.studyRequests.push(body);
      const output = { answer: "The derivative of x squared is twice x.", sourceIds: ["S1"], questions: [] };
      return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }), { headers: { "Content-Type": "application/json" } });
    };
  });
  await page.evaluate(async () => {
    await window.study.addDocument({ title: "Unselected private note", content: "NEVER_SHARE_THIS_PASSAGE", course: "" });
    await window.study.addDocument({ title: "Desktop lecture", content: "The derivative of x squared is twice x.", course: "" });
  });
  await page.reload();
  await page.locator(".attachment-menu > summary").click();
  await page.getByRole("checkbox", { name: "Desktop lecture" }).check();
  await page.locator(".attachment-menu > summary").click();
  await page.getByLabel("Message", { exact: true }).fill("Explain the derivative");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.locator(".message-text").filter({ hasText: "The derivative of x squared is twice x." }).waitFor();
  const requests = await desktop.evaluate(() => globalThis.studyRequests);
  assert.equal(requests.length, 1);
  assert.ok(!JSON.stringify(requests).includes("NEVER_SHARE_THIS_PASSAGE"));
  assert.equal(requests[0].tools[0].name, "list_courses");
  await page.reload();
  await page.locator(".message-text").filter({ hasText: "The derivative of x squared is twice x." }).waitFor();
  await desktop.evaluate(() => {
    let round = 0;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      if (!body.instructions.includes("tutorial sheets")) throw Error("Saved Memory missing from request");
      const output = round++ === 0 ? [{ type: "function_call", name: "save_page", call_id: "save_fixture", arguments: JSON.stringify({ id: null, revision: null, title: "AI Homework", content: "Saved by the assistant [S1].", source_ids: ["S1"] }) }] : [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ answer: "Your Homework page is saved.", sourceIds: ["S1"], questions: [] }) }] }];
      return new Response(JSON.stringify({ status: "completed", output }));
    };
  });
  await page.locator(".attachment-menu > summary").click();
  await page.getByRole("checkbox", { name: "Desktop lecture" }).check();
  await page.locator(".attachment-menu > summary").click();
  await page.getByLabel("Message", { exact: true }).fill("Create and save my Homework sidebar page.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("Your Homework page is saved.", { exact: true }).waitFor();
  await sidebar.getByRole("button", { name: "AI Homework", exact: true }).click();
  await page.getByText("Saved by the assistant [S1].", { exact: true }).waitFor();
  await sidebar.getByRole("button", { name: "Chat", exact: true }).click();
  // Exercise the real OAuth listener and JOSE validation with an isolated test issuer transport.
  const keys = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(keys.publicKey), kid: "desktop-fixture", alg: "RS256", use: "sig" };
  await desktop.evaluate(({ shell }, jwk) => {
    const prior = globalThis.fetch;
    shell.openExternal = async url => {
      if (new URL(url).origin === "https://auth.openai.com") { globalThis.studyAuthUrl = url; return; }
      throw new Error("Unexpected external test URL");
    };
    globalThis.fetch = async (url, options = {}) => {
      const origin = "https://auth.openai.com";
      const json = body => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
      if (url === `${origin}/.well-known/openid-configuration`) return json({ issuer: origin, authorization_endpoint: `${origin}/api/accounts/authorize`, token_endpoint: `${origin}/api/accounts/oauth/token`, jwks_uri: `${origin}/.well-known/jwks.json`, revocation_endpoint: `${origin}/api/accounts/oauth/revoke` });
      if (url === `${origin}/.well-known/jwks.json` || String(url) === `${origin}/.well-known/jwks.json`) return json({ keys: [jwk] });
      if (url === `${origin}/api/accounts/oauth/token`) return json({ access_token: "desktop-plan-access", refresh_token: "desktop-plan-refresh", id_token: globalThis.studyIdToken, token_type: "Bearer", expires_in: 3600, scope: "openid email profile offline_access resource.invoke chatgpt.tokens.use.direct" });
      if (url === `${origin}/api/accounts/oauth/revoke`) return new Response(null, { status: 200 });
      if (url === "https://api.openai.com/v1/models") return json({ models: [{ slug: "desktop-plan-model", display_name: "Desktop plan model", visibility: "list" }] });
      if (url === "https://api.openai.com/v1/responses" && JSON.parse(options.body).stream) {
        globalThis.studyPlanRequest = JSON.parse(options.body);
        const output = { answer: "Subscription test answer.", sourceIds: [], questions: [] };
        // Match the real subscription response: text arrives before an empty terminal output.
        return new Response(`data: ${JSON.stringify({ type: "response.output_text.done", output_index: 0, content_index: 0, text: JSON.stringify(output) })}\n\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [] } })}\n\n`);
      }
      return prior(url, options);
    };
  }, jwk);
  await page.locator(".connections > summary").click();
  await page.getByRole("button", { name: "Continue with ChatGPT", exact: true }).click();
  let authUrl;
  for (let attempt = 0; attempt < 40 && !authUrl; attempt++) {
    authUrl = await desktop.evaluate(() => globalThis.studyAuthUrl);
    if (!authUrl) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(authUrl, "OAuth opens the system browser through the controlled test transport");
  const authorize = new URL(authUrl);
  const idToken = await new SignJWT({ sub: "desktop-subject", nonce: authorize.searchParams.get("nonce"), email: "desktop@example.test" }).setProtectedHeader({ alg: "RS256", kid: "desktop-fixture" }).setIssuer("https://auth.openai.com").setAudience("oaiapp_desktop_fixture").setIssuedAt().setExpirationTime("5m").sign(keys.privateKey);
  await desktop.evaluate((_electron, token) => { globalThis.studyIdToken = token; }, idToken);
  const callback = new URL(authorize.searchParams.get("redirect_uri"));
  callback.search = new URLSearchParams({ code: "desktop-code", state: authorize.searchParams.get("state"), client_id: "oaiapp_desktop_fixture" });
  assert.equal((await fetch(callback)).status, 200);
  await page.getByRole("dialog").getByRole("button", { name: "Got it", exact: true }).click();
  assert.equal((await page.evaluate(() => window.study.aiStatus())).chatgpt.planEnabled, true);
  await page.getByLabel("ChatGPT model", { exact: true }).selectOption("desktop-plan-model");
  assert.equal((await page.evaluate(() => window.study.aiStatus())).mode, "chatgpt");
  await page.locator(".connections > summary").filter({ hasText: "ChatGPT plan" }).waitFor();
  await page.getByLabel("Message", { exact: true }).fill("Give me a study tip");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("Subscription test answer.", { exact: true }).waitFor();
  const planRequest = await desktop.evaluate(() => globalThis.studyPlanRequest);
  assert.equal(planRequest.stream, true);
  assert.equal(planRequest.max_output_tokens, undefined);
  assert.equal(planRequest.model, "desktop-plan-model");
  await desktop.evaluate(() => { globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "subscription_sharing_usage_limit_exceeded" } }), { status: 429, headers: { "Content-Type": "application/json" } }); });
  await page.getByLabel("Message", { exact: true }).fill("Another question");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const friendlyError = page.getByRole("alert").filter({ hasText: "usage limit" });
  await friendlyError.waitFor();
  assert.ok(!(await friendlyError.innerText()).includes("Error invoking remote method"));
  const planStatus = await page.evaluate(() => window.study.aiStatus());
  assert.ok(!JSON.stringify(planStatus).includes("desktop-plan-access"));
  const signedOut = await page.evaluate(() => window.study.signOutChatGpt());
  assert.match(signedOut.warning, /could not be confirmed/, "A provider outage is disclosed while local sign-out still works");
  assert.equal((await page.evaluate(() => window.study.aiStatus())).configured, false, "Signing out never silently switches to the saved API key");

  await page.evaluate(async () => { await window.study.saveSettings({ aiMode: "api-key" }); await window.study.clearChat(); await window.study.disconnectAi(); });
  console.log("Desktop checks passed: sidebar navigation, persistent memory.md, AI-created pages, sandboxed IPC, encrypted key, selected materials, real OAuth callback/JWT verification, subscription model selection/SSE and explicit billing. Providers mocked.");
} finally { if (desktop) await desktop.close(); }
