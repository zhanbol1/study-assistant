import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  utilityProcess,
  session,
  protocol,
  net,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStore } from "./store.mjs";
import { numericId, moodleUrl } from "./validation.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const devUrl = process.env.STUDY_DEV_URL;
if (devUrl && devUrl !== "http://127.0.0.1:5173")
  throw new Error("Unsupported development origin.");
const smokeTest = process.argv.includes("--smoke-test");
let store;
let window;
let syncing = false;
const workers = new Set();

async function readMoodle(operation, courseId) {
  if (syncing) throw new Error("A Moodle sync is already running.");
  if (process.platform !== "win32")
    throw new Error(
      "Moodle credential storage currently requires Windows. Local tasks work on this platform.",
    );
  syncing = true;
  try {
    return await new Promise((resolve, reject) => {
      const child = utilityProcess.fork(
        path.join(root, "desktop/moodle-worker.mjs"),
        [],
        {
          stdio: "ignore",
          env: {
            ...process.env,
            LMS_HEADLESS: "false",
            PLAYWRIGHT_BROWSERS_PATH: path.join(
              root,
              "lms-agent/.playwright-browsers",
            ),
            LMS_DATA_DIR: path.join(app.getPath("userData"), "moodle"),
          },
        },
      );
      workers.add(child);
      let finished = false;
      const timer = setTimeout(
        () =>
          finish(
            new Error("Moodle sync timed out. Your saved data is unchanged."),
          ),
        180_000,
      );
      function finish(error, value) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        workers.delete(child);
        child.kill();
        if (error) reject(error);
        else resolve(value);
      }
      child.on("spawn", () => child.postMessage({ operation, courseId }));
      child.on("message", (message) => {
        if (message?.ok === true) finish(null, message.result);
        else
          finish(
            new Error(
              typeof message?.error === "string"
                ? message.error
                : "Moodle sync failed.",
            ),
          );
      });
      child.on("exit", () =>
        finish(
          new Error(
            "Moodle worker stopped before completing. Your saved data is unchanged.",
          ),
        ),
      );
    });
  } finally {
    syncing = false;
  }
}

function handle(channel, action) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      throw new Error("Untrusted application frame.");
    }
    return action(...args);
  });
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 920,
    minHeight: 650,
    backgroundColor: "#f7f8fa",
    title: "Study Assistant",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(root, "desktop/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.once("ready-to-show", () => {
    if (!smokeTest) window.show();
    console.log("[study] Desktop window ready.");
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[study] Renderer stopped:", details.reason);
  });
  window.on("closed", () => {
    window = null;
  });
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadURL("study://app/index.html");
}

// Called by the synchronous bootstrap only after Electron is ready.
export async function start() {
  console.log("[study] Initializing local workspace...");
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  store = createStore(path.join(app.getPath("userData"), "study.sqlite"));
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  protocol.handle("study", (request) => {
    const url = new URL(request.url);
    if (url.host !== "app" || url.username || url.password)
      return new Response("Forbidden", { status: 403 });
    const dist = path.join(root, "dist");
    const filename = path.resolve(dist, "." + decodeURIComponent(url.pathname));
    if (!filename.startsWith(dist + path.sep))
      return new Response("Forbidden", { status: 403 });
    return net.fetch(pathToFileURL(filename).toString());
  });
  handle("study:snapshot", () => store.snapshot());
  handle("study:add-task", (input) => store.addTask(input));
  handle("study:toggle-task", (id) => store.toggleTask(id));
  handle("study:delete-task", (id) => store.deleteTask(id));
  handle("study:add-routine", (input) => store.addRoutine(input));
  handle("study:delete-routine", (id) => store.deleteRoutine(id));
  handle("study:sync-courses", async () =>
    store.cacheCourses(await readMoodle("courses")),
  );
  handle("study:sync-assignments", async (id) =>
    store.cacheAssignments(
      numericId(id),
      await readMoodle("assignments", numericId(id)),
    ),
  );
  handle("study:open-source", async (url) => {
    await shell.openExternal(moodleUrl(url));
  });
  await createWindow();
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  for (const child of workers) child.kill();
});
app.on("will-quit", () => store?.close());
