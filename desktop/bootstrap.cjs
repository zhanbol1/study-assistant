// Keep Electron's entry point synchronous. ESM evaluation must not hold up ready.
const { app, dialog, protocol, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.setName("Study Assistant");
if (process.platform === "win32") app.setAppUserModelId("Study Assistant");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "study",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
const smokeTest = process.argv.includes("--smoke-test");
const ownsWorkspace = smokeTest || app.requestSingleInstanceLock();
if (!ownsWorkspace) app.quit();
app.on("second-instance", (_event, args) => {
  const existing = BrowserWindow.getAllWindows()[0];
  if (existing) { if (existing.isMinimized()) existing.restore(); existing.show(); existing.focus(); }
  if (args.includes("--connect-chatgpt")) {
    app.studyConnectRequested = true;
    app.emit("study:connect-chatgpt");
  }
});
if (smokeTest) {
  const data = path.resolve(__dirname, "../.runtime/desktop-smoke");
  fs.mkdirSync(data, { recursive: true });
  app.setPath("userData", data);
  app.setPath("sessionData", data);
}

console.log("[study] Starting Electron...");
if (ownsWorkspace) app
  .whenReady()
  .then(async () => {
    console.log("[study] Electron ready. Loading application...");
    const { start } = await import("./main.mjs");
    await start();
  })
  .catch((error) => {
    console.error("[study] Startup failed:", error);
    if (!smokeTest) {
      dialog.showErrorBox(
        "Study Assistant could not start",
        error instanceof Error ? error.message : String(error),
      );
    }
    app.exit(1);
  });
