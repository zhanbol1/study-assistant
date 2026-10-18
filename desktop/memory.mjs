import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const defaultMemory = `# My study instructions

## Finding homework
- Check the relevant Moodle course and assignment instructions, including attached files when I ask you to read them.
- Separate homework, quizzes and exams. Include the course and source link.

## Completed work
- Use explicit submission or completion evidence, or my own statement that I finished it.
- A passed deadline or a downloaded file does not mean homework is done.
- If completion cannot be checked, say it is unknown.

## Deadlines
- Compare explicit Moodle dates with the current time in my Moodle time zone.
- Separate upcoming, past-deadline and undated work. Never invent a deadline.

## My preferences
- Add my course-specific rules and study preferences here.
`;
export const memoryRevision = content => createHash("sha256").update(content).digest("hex");
export function checkMemory(content) {
  if (typeof content !== "string" || content.length > 20000 || content.includes("\0")) throw new Error("Memory must be text, up to 20,000 characters.");
  return content;
}
export function createMemoryFile(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  if (!fs.existsSync(filename)) fs.writeFileSync(filename, defaultMemory, { flag: "wx" });
  return {
    read() {
      if (fs.statSync(filename).size > 80000) throw new Error("memory.md is too large. Reduce it to 20,000 characters.");
      const content = checkMemory(fs.readFileSync(filename, "utf8"));
      return { content, revision: memoryRevision(content) };
    },
    save(content, expectedRevision) {
      checkMemory(content);
      if (this.read().revision !== expectedRevision) throw new Error("Memory changed elsewhere. Reload the saved version before saving your edits.");
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try { fs.writeFileSync(temporary, content, { flag: "wx" }); fs.renameSync(temporary, filename); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    },
  };
}
