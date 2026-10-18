// Native startup regression check. Does not show a window or contact Moodle.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import fs from "node:fs/promises";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const { _electron } = await import(
  "../lms-agent/node_modules/playwright/index.mjs"
);
const env = { ...process.env, OPENAI_API_KEY: "" };
delete env.ELECTRON_RUN_AS_NODE;
let desktop;
try {
  await fs.rm(path.join(root, ".runtime/desktop-smoke/chatgpt-session.bin"), { force: true });
  desktop = await _electron.launch({
    executablePath: path.join(
      root,
      "node_modules/electron/dist",
      process.platform === "win32"
        ? "electron.exe"
        : process.platform === "darwin"
          ? "Electron.app/Contents/MacOS/Electron"
          : "electron",
    ),
    args: [root, "--smoke-test"],
    env,
    timeout: 20_000,
  });
  const page = await desktop.firstWindow({ timeout: 15_000 });
  page.setDefaultTimeout(15000);
  await page
    .getByRole("heading", { name: "A little clarity. A better study day." })
    .waitFor();
  assert.equal(
    await page.evaluate(() => typeof window.study?.snapshot),
    "function",
  );
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.equal(
    await page.getByText("Preview · sample data", { exact: true }).count(),
    0,
  );
  const snapshot = await page.evaluate(() => window.study.snapshot());
  assert.ok(Array.isArray(snapshot.tasks));
  // Reset only the isolated smoke workspace so interrupted checks are repeatable.
  await page.evaluate(async () => {
    await window.study.saveSettings({ backgroundEnabled: false });
    await window.study.disconnectAi();
    await window.study.clearChat();
    const saved = await window.study.snapshot();
    for (const doc of saved.documents) await window.study.deleteDocument(doc.id);
    for (const routine of saved.routines) await window.study.deleteRoutine(routine.id);
  });
  const edited = await page.evaluate(async () => {
    const input = { title: "Desktop edit check", course: "", notes: "", kind: "study", dueAt: "" };
    const before = await window.study.snapshot();
    const added = await window.study.addTask(input);
    const task = added.tasks.find((item) => !before.tasks.some((old) => old.id === item.id));
    try {
      const updated = await window.study.updateTask(task.id, { ...input, notes: "Saved through IPC" });
      return updated.tasks.find((item) => item.id === task.id);
    } finally {
      await window.study.deleteTask(task.id);
    }
  });
  assert.equal(edited.notes, "Saved through IPC");
  assert.equal(edited.source, "manual");
  // Replace the provider transport only in the test process. No network request is made.
  await desktop.evaluate(() => {
    globalThis.studyRequests = [];
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(options.body);
      globalThis.studyRequests.push(request);
      const quiz = request.instructions.includes("Create 5");
      const output = { answer: quiz ? "Practice the derivative." : "The derivative of x squared is twice x.", sourceIds: ["S1"],
        questions: quiz ? [{ question: "What is the derivative of x squared?", choices: ["2x", "x"], answerIndex: 0, explanation: "Apply the power rule." }] : [] };
      return { ok: true, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }] }) };
    };
  });
  await page.getByRole("button", { name: "Settings & connections", exact: true }).click();
  await page.getByLabel("API key", { exact: true }).fill("smoke-only-test-key");
  await page.getByRole("button", { name: "Save connection", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Connection settings saved" }).waitFor();
  assert.equal(await page.getByLabel("API key", { exact: true }).inputValue(), "");
  assert.equal((await page.evaluate(() => window.study.aiStatus())).configured, true);
  await page.evaluate(() => window.study.addDocument({ title: "Unselected private note", content: "NEVER_SHARE_THIS_PASSAGE", course: "" }));
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByRole("button", { name: "Paste notes", exact: true }).click();
  await page.getByLabel("Material title", { exact: true }).fill("Desktop lecture");
  await page.getByLabel("Study notes", { exact: true }).fill("The derivative of x squared is twice x.");
  await page.getByRole("button", { name: "Save material", exact: true }).click();
  await page.getByRole("checkbox", { name: /Desktop lecture/ }).check();
  await page.getByLabel("Your question", { exact: true }).fill("Explain the derivative");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.locator(".chat-message.assistant > p").filter({ hasText: "The derivative of x squared is twice x." }).waitFor();
  await page.getByLabel("Your question", { exact: true }).fill("Test my knowledge of derivatives");
  await page.getByRole("button", { name: "Make practice quiz", exact: true }).click();
  await page.getByRole("radio", { name: "2x", exact: true }).check();
  await page.getByRole("button", { name: "Check answers", exact: true }).click();
  await page.getByText("Score: 1 / 1", { exact: true }).waitFor();
  const requests = await desktop.evaluate(() => globalThis.studyRequests);
  assert.equal(requests.length, 2);
  assert.ok(!JSON.stringify(requests).includes("NEVER_SHARE_THIS_PASSAGE"));
  assert.ok(requests.every(request => request.store === false));
  await page.reload();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByText("Practice the derivative.", { exact: true }).waitFor();
  const reminder = await page.evaluate(async () => {
    const added = await window.study.addRoutine({ name: "Desktop reminder", instructions: "Review derivatives", action: "reminder" });
    const routine = added.routines.at(-1);
    await window.study.setRoutineSchedule(routine.id, "daily");
    const result = await window.study.runRoutine(routine.id);
    await window.study.deleteRoutine(routine.id);
    return result;
  });
  assert.ok(reminder.notices.some(notice => notice.body === "Review derivatives"));
  assert.ok(reminder.routines.at(-1).lastRunAt);
  assert.ok(reminder.routines.at(-1).nextRunAt);
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
        return new Response(`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }] } })}\n\n`);
      }
      return prior(url, options);
    };
  }, jwk);
  await page.getByRole("button", { name: "Settings & connections", exact: true }).click();
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
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByText(/Using ChatGPT plan/).waitFor();
  await page.getByLabel("Your question", { exact: true }).fill("Give me a study tip");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByText("Subscription test answer.", { exact: true }).waitFor();
  const planRequest = await desktop.evaluate(() => globalThis.studyPlanRequest);
  assert.equal(planRequest.stream, true);
  assert.equal(planRequest.max_output_tokens, undefined);
  assert.equal(planRequest.model, "desktop-plan-model");
  const planStatus = await page.evaluate(() => window.study.aiStatus());
  assert.ok(!JSON.stringify(planStatus).includes("desktop-plan-access"));
  const signedOut = await page.evaluate(() => window.study.signOutChatGpt());
  assert.equal(signedOut.warning, "");
  assert.equal((await page.evaluate(() => window.study.aiStatus())).configured, false, "Signing out never silently switches to the saved API key");
  await page.evaluate(() => window.study.saveSettings({ backgroundEnabled: true }));
  const hidden = await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.close();
    return { retained: !window.isDestroyed(), visible: window.isVisible() };
  });
  assert.deepEqual(hidden, { retained: true, visible: false }, "Closing keeps the workspace alive in the tray");
  await page.evaluate(async () => {
    await window.study.saveSettings({ backgroundEnabled: false });
    await window.study.saveSettings({ aiMode: "api-key" });
    await window.study.clearChat();
    for (const doc of (await window.study.snapshot()).documents) await window.study.deleteDocument(doc.id);
    await window.study.disconnectAi();
  });
  console.log(
    "Desktop checks passed: startup, sandboxed IPC, persistence, API chat, quiz scoring, ChatGPT OAuth callback and JWT verification, subscription model selection and streaming, explicit billing mode, reminders, and close-to-tray. All provider requests were mocked.",
  );
} finally {
  if (desktop) await desktop.close();
}
