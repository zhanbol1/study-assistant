import { createServer } from "vite";
import { spawn } from "node:child_process";
import electron from "electron";

const server = await createServer({ configLoader: "runner" });
await server.listen();
const env = { ...process.env, STUDY_DEV_URL: "http://127.0.0.1:5173" };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], {
  stdio: "inherit",
  env,
  windowsHide: true,
});
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  child.kill();
  await server.close();
  process.exit(code);
}
child.on("error", (error) => {
  console.error(error.message);
  void stop(1);
});
child.on("exit", (code) => void stop(code ?? 0));
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
