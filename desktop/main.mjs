import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  utilityProcess,
  session,
  protocol,
  net,
  safeStorage,
  dialog,
  Notification,
  Tray,
  Menu,
  nativeImage,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStore } from "./store.mjs";
import { numericId, moodleUrl } from "./validation.mjs";
import { settingsInput } from "./validation.mjs";
import { createKeyVault, createAssistant, searchDocuments } from "./ai.mjs";
import { createScheduler } from "./scheduler.mjs";
import { createChatGptAuth } from "./chatgpt-auth.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const devUrl = process.env.STUDY_DEV_URL;
if (devUrl && devUrl !== "http://127.0.0.1:5173")
  throw new Error("Unsupported development origin.");
const smokeTest = process.argv.includes("--smoke-test");
let store;
let window;
let syncing = false;
let assistant;
let vault;
let chatgpt;
let scheduler;
let schedulerTimer;
let tray;
let quitting = false;
let chatgptError = "";
const workers = new Set();

async function readMoodle(operation, courseId, background = false) {
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
            OPENAI_API_KEY: "",
            LMS_HEADLESS: background ? "true" : "false",
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
        600_000,
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
      child.on("spawn", () => child.postMessage({ operation, courseId, timeZone: store.snapshot().settings.timeZone }));
      child.on("error", () => finish(new Error("Moodle worker could not start.")));
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

function broadcast() {
  if (window && !window.isDestroyed()) window.webContents.send("study:changed", store.snapshot());
}

async function showWorkspace() {
  if (!window) await createWindow();
  window.show();
  window.focus();
}

async function connectChatGpt(options) {
  chatgptError = "";
  try {
    const status = await chatgpt.signIn(options);
    assistant.cancel();
    store.saveSettings({ aiMode: "chatgpt" });
    if (status.planEnabled) {
      try { await chatgpt.listModels(); }
      catch (error) { chatgptError = error.message; }
    }
    return store.snapshot();
  } catch (error) { chatgptError = error.message; throw error; }
  finally { broadcast(); }
}

function startChatGptSignIn() {
  if (window) window.webContents.send("study:open-settings");
  void connectChatGpt().then(() => console.log(chatgpt.status().planEnabled
    ? "[study] ChatGPT plan authorization completed. Review the model selection in Settings."
    : "[study] ChatGPT sign-in completed, but plan usage is not enabled. Review Settings."))
    .catch(() => console.log("[study] ChatGPT sign-in did not complete. See Settings to retry."));
}

function updateBackground() {
  if (store.snapshot().settings.backgroundEnabled && !tray) {
    const pixels = Buffer.alloc(16 * 16 * 4);
    const glyph = ["01110", "10000", "10000", "01110", "00001", "00001", "11110"];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const foreground = glyph[y - 4]?.[x - 5] === "1";
      const index = (y * 16 + x) * 4;
      pixels.set(foreground ? [255, 255, 255, 255] : [195, 105, 110, 255], index);
    }
    tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 16, height: 16 }));
    tray.setToolTip("Study Assistant — reminders running");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Study Assistant", click: () => void showWorkspace() },
      { label: "Quit", click: () => app.quit() },
    ]));
    tray.on("double-click", () => void showWorkspace());
  } else if (!store.snapshot().settings.backgroundEnabled && tray) {
    tray.destroy();
    tray = null;
  }
}

function syncCourse(id, background = false) {
  numericId(id);
  return readMoodle("assignments", id, background).then(result => store.cacheAssignments(id, result));
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
  window.on("close", event => {
    if (!quitting && tray && store.snapshot().settings.backgroundEnabled) {
      event.preventDefault();
      window.hide();
    }
  });
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadURL(`study://app/index.html${process.argv.includes("--connect-chatgpt") ? "#connections" : ""}`);
}

// Called by the synchronous bootstrap only after Electron is ready.
export async function start() {
  console.log("[study] Initializing local workspace...");
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  store = createStore(path.join(app.getPath("userData"), "study.sqlite"));
  vault = createKeyVault(path.join(app.getPath("userData"), "openai-key.bin"), safeStorage);
  chatgpt = createChatGptAuth({ filename: path.join(app.getPath("userData"), "chatgpt-session.bin"), encryption: safeStorage, openBrowser: url => shell.openExternal(url), onChange: broadcast });
  assistant = createAssistant({ store, vault, credentials: () => store.snapshot().settings.aiMode === "chatgpt"
    ? chatgpt.credentials() : { key: vault.read(), model: store.snapshot().settings.model } });
  scheduler = createScheduler({ store, syncCourse: id => syncCourse(id, true), notify: (title, body) => {
    broadcast();
    if (!smokeTest && Notification.isSupported()) {
      const notification = new Notification({ title, body, silent: false });
      notification.on("click", () => void showWorkspace());
      notification.show();
    }
  } });
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
  handle("study:update-task", (id, input) => store.updateTask(id, input));
  handle("study:toggle-task", (id) => store.toggleTask(id));
  handle("study:delete-task", (id) => store.deleteTask(id));
  handle("study:add-routine", (input) => store.addRoutine(input));
  handle("study:delete-routine", (id) => store.deleteRoutine(id));
  handle("study:routine-schedule", (id, cadence) => store.setRoutineSchedule(id, cadence));
  handle("study:run-routine", async id => {
    try { return await scheduler.runRoutine(id); } finally { broadcast(); }
  });
  handle("study:settings", input => {
    if (input?.aiMode && input.aiMode !== store.snapshot().settings.aiMode) assistant.cancel();
    const result = store.saveSettings(input);
    updateBackground();
    return result;
  });
  handle("study:read-notices", () => store.markNoticesRead());
  handle("study:ai-status", () => {
    const mode = store.snapshot().settings.aiMode;
    let plan;
    try { plan = chatgpt.status(); } catch (error) { plan = { signedIn: false, planEnabled: false, model: "", models: [], error: error.message }; }
    return { configured: mode === "chatgpt" ? plan.planEnabled : vault.configured(), apiKeyConfigured: vault.configured(), mode, chatgpt: { ...plan, error: chatgptError || plan.error }, fromEnvironment: Boolean(process.env.OPENAI_API_KEY) };
  });
  handle("study:ai-connect", input => {
    const checked = settingsInput({ model: input?.model, aiMode: "api-key" }, store.snapshot().settings);
    if (input?.key) vault.save(input.key);
    assistant.cancel();
    return store.saveSettings(checked);
  });
  handle("study:ai-disconnect", () => { assistant.cancel(); vault.remove(); return store.snapshot(); });
  handle("study:chatgpt-sign-in", async options => {
    if (options !== undefined && (!options || typeof options !== "object" || (options.newAccount !== undefined && typeof options.newAccount !== "boolean") || (options.consent !== undefined && typeof options.consent !== "boolean"))) throw new Error("Invalid sign-in options.");
    return connectChatGpt(options);
  });
  handle("study:chatgpt-cancel", () => { chatgpt.cancelSignIn(); return store.snapshot(); });
  handle("study:chatgpt-sign-out", async () => {
    assistant.cancel();
    const status = await chatgpt.signOut();
    broadcast();
    return { snapshot: store.snapshot(), warning: status.warning };
  });
  handle("study:chatgpt-models", async () => { await chatgpt.listModels(); chatgptError = ""; return store.snapshot(); });
  handle("study:chatgpt-model", id => { chatgpt.selectModel(id); return store.snapshot(); });
  handle("study:chatgpt-welcome", () => { chatgpt.acknowledgeWelcome(); return store.snapshot(); });
  handle("study:chatgpt-usage", () => shell.openExternal("https://chatgpt.com/#settings/Usage"));
  handle("study:ai-send", input => assistant.send(input));
  handle("study:clear-chat", () => assistant.clear());
  handle("study:add-document", input => store.addDocument(input));
  handle("study:delete-document", id => store.deleteDocument(id));
  handle("study:search-documents", query => searchDocuments(query, store.documents()));
  handle("study:import-document", async course => {
    const selected = await dialog.showOpenDialog(window, { title: "Add study material", properties: ["openFile"], filters: [{ name: "Text and Markdown", extensions: ["txt", "md"] }] });
    if (selected.canceled || !selected.filePaths[0]) return store.snapshot();
    const filename = selected.filePaths[0];
    if (![".txt", ".md"].includes(path.extname(filename).toLowerCase())) throw new Error("Choose a .txt or .md file.");
    if (fs.statSync(filename).size > 500000) throw new Error("Choose a text file smaller than 500 KB.");
    const content = fs.readFileSync(filename, "utf8");
    if (content.includes("\u0000")) throw new Error("Choose a plain text file.");
    return store.addDocument({ title: path.basename(filename), course, content });
  });
  handle("study:sync-courses", async () =>
    store.cacheCourses(await readMoodle("courses")),
  );
  handle("study:sync-assignments", id => syncCourse(id));
  handle("study:open-source", async (url) => {
    await shell.openExternal(moodleUrl(url));
  });
  await createWindow();
  app.on("study:connect-chatgpt", startChatGptSignIn);
  if (!smokeTest && (process.argv.includes("--connect-chatgpt") || app.studyConnectRequested)) startChatGptSignIn();
  updateBackground();
  if (!smokeTest) {
    const tick = () => void scheduler.tick().then(broadcast).catch(() => {});
    schedulerTimer = setInterval(tick, 30000);
    tick();
  }
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  chatgpt?.cancelSignIn();
  quitting = true;
  clearInterval(schedulerTimer);
  tray?.destroy();
  for (const child of workers) child.kill();
});
app.on("will-quit", () => store?.close());
