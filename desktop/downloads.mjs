import fs from "node:fs";
import path from "node:path";

export function managedDownload(filename, directory) {
  if (typeof filename !== "string" || !path.isAbsolute(filename)) throw new Error("Invalid downloaded file.");
  const root = fs.realpathSync(directory);
  const actual = fs.realpathSync(filename);
  const relative = path.relative(root, actual);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative) || !fs.statSync(actual).isFile()) throw new Error("File is outside the managed downloads folder.");
  return actual;
}
