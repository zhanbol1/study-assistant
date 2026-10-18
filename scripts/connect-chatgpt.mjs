import { spawn } from "node:child_process";
import electron from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [root, "--connect-chatgpt"], { cwd: root, env, stdio: "inherit", windowsHide: true });
child.on("error", () => { console.error("Study Assistant could not start. Run npm start from your own terminal."); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
