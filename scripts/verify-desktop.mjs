// Native startup regression check. Does not show a window or contact Moodle.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const { _electron } = await import(
  "../lms-agent/node_modules/playwright/index.mjs"
);
const env = { ...process.env };
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
  console.log(
    "Desktop startup check passed: native window loaded, preload connected, SQLite readable, task editing through IPC, no preview data.",
  );
} finally {
  if (desktop) await desktop.close();
}
