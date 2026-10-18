// Native startup regression check. Does not show a window or contact Moodle.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const { _electron } = await import(
  "../lms-agent/node_modules/playwright/index.mjs"
);
const env = { ...process.env, OPENAI_API_KEY: "" };
delete env.ELECTRON_RUN_AS_NODE;
let desktop;
try {
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
  await page.evaluate(() => window.study.saveSettings({ backgroundEnabled: true }));
  const hidden = await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.close();
    return { retained: !window.isDestroyed(), visible: window.isVisible() };
  });
  assert.deepEqual(hidden, { retained: true, visible: false }, "Closing keeps the workspace alive in the tray");
  await page.evaluate(async () => {
    await window.study.saveSettings({ backgroundEnabled: false });
    await window.study.clearChat();
    for (const doc of (await window.study.snapshot()).documents) await window.study.deleteDocument(doc.id);
    await window.study.disconnectAi();
  });
  console.log(
    "Desktop checks passed: native startup, sandboxed preload, SQLite editing, encrypted key setup, material selection, mocked AI chat, quiz scoring, persistence, reminder execution, and close-to-tray lifecycle. No AI or Moodle network calls were made.",
  );
} finally {
  if (desktop) await desktop.close();
}
