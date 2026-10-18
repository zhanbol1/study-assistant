import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createMemoryFile, defaultMemory, checkMemory, memoryRevision } from "./memory.mjs";
import {
  taskInput,
  routineInput,
  text,
  numericId,
  moodleUrl,
  defaultSettings,
  settingsInput,
  optionalDate,
} from "./validation.mjs";

export function createStore(filename) {
  const memoryFile = filename === ":memory:" ? null : createMemoryFile(path.join(path.dirname(filename), "memory.md"));
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, type TEXT NOT NULL, body TEXT NOT NULL);
    PRAGMA user_version = 1;
  `);
  const put = db.prepare(
    "INSERT OR REPLACE INTO records (id, type, body) VALUES (?, ?, ?)",
  );
  const get = (id) => {
    const row = db.prepare("SELECT body FROM records WHERE id = ?").get(id);
    return row ? JSON.parse(row.body) : null;
  };
  const all = (type) =>
    db
      .prepare("SELECT body FROM records WHERE type = ? ORDER BY rowid")
      .all(type)
      .map((row) => JSON.parse(row.body));
  function save(id, type, body) {
    put.run(id, type, JSON.stringify(body));
    return body;
  }

  return {
    snapshot() {
      return {
        tasks: all("task"),
        courses: all("course"),
        routines: all("routine"),
        sync: get("sync"),
        settings: { ...defaultSettings(), ...get("settings") },
        documents: all("document").map(({ content, ...metadata }) => metadata),
        messages: all("message"),
        notices: all("notice"),
        memory: memoryFile ? memoryFile.read() : get("memory") || { content: defaultMemory, revision: memoryRevision(defaultMemory) },
        pages: all("page"),
        downloads: all("download").map(({ path, ...metadata }) => metadata),
      };
    },
    saveMemory(content, revision) {
      checkMemory(content);
      if (memoryFile) memoryFile.save(content, revision);
      else {
        if (this.snapshot().memory.revision !== revision) throw new Error("Memory changed elsewhere. Reload before saving.");
        save("memory", "meta", { content, revision: memoryRevision(content) });
      }
      return this.snapshot();
    },
    savePage(input) {
      const title = text(input?.title, "Page title", 100);
      const content = text(input?.content, "Page content", 30000, true);
      const previous = input.id ? all("page").find(page => page.id === input.id) : null;
      if (input.id && !previous) throw new Error("Saved page not found.");
      if (previous && previous.revision !== input.revision) throw new Error("This page changed. Read the latest version before updating it.");
      if (!previous && all("page").length >= 50) throw new Error("You can save up to 50 pages.");
      if (input.sources !== undefined && (!Array.isArray(input.sources) || input.sources.length > 200)) throw new Error("Invalid page sources.");
      const sources = (input.sources || []).map(source => ({ reference: text(source.reference, "Reference", 30), title: text(source.title, "Source title", 500), ...(source.sourceUrl ? { sourceUrl: moodleUrl(source.sourceUrl) } : {}) }));
      const page = { id: previous?.id || randomUUID(), title, content, sources, revision: randomUUID(), updatedAt: new Date().toISOString(), createdAt: previous?.createdAt || new Date().toISOString() };
      save(page.id, "page", page);
      return page;
    },
    deletePage(id, revision) {
      const page = all("page").find(page => page.id === id);
      if (!page || page.revision !== revision) throw new Error("Page changed or was removed. Reload before deleting.");
      db.prepare("DELETE FROM records WHERE id = ? AND type = 'page'").run(id);
      return this.snapshot();
    },
    addDownload(input) {
      const existing = all("download").find(file => file.path === input.path && file.sourceUrl === input.sourceUrl && file.bytes === input.bytes);
      if (existing) { const { path: localPath, ...metadata } = existing; return metadata; }
      const download = { id: randomUUID(), filename: text(input.filename, "Filename", 250), path: text(input.path, "File path", 2000), bytes: input.bytes, course: text(input.course, "Course", 500), sourceUrl: moodleUrl(input.sourceUrl), createdAt: new Date().toISOString() };
      if (!Number.isSafeInteger(download.bytes) || download.bytes < 0 || download.bytes > 100 * 1024 * 1024) throw new Error("Invalid downloaded file size.");
      save(download.id, "download", download);
      const { path: localPath, ...metadata } = download;
      return metadata;
    },
    download(id) { return all("download").find(file => file.id === id); },
    addTask(input) {
      const task = {
        ...taskInput(input),
        id: randomUUID(),
        completed: false,
        source: "manual",
        sourceUrl: "",
        createdAt: new Date().toISOString(),
      };
      save(task.id, "task", task);
      return this.snapshot();
    },
    toggleTask(id) {
      text(id, "Task ID", 100);
      const task = get(id);
      if (!task || !["manual", "moodle"].includes(task.source))
        throw new Error("Task not found.");
      save(id, "task", { ...task, completed: !task.completed });
      return this.snapshot();
    },
    updateTask(id, input) {
      text(id, "Task ID", 100);
      const task = get(id);
      if (!task || !["manual", "moodle"].includes(task.source))
        throw new Error("Task not found.");
      const checked = taskInput(input);
      const localFields = new Set(task.localFields || []);
      for (const key of Object.keys(checked)) {
        if (checked[key] !== task[key]) localFields.add(key);
      }
      save(id, "task", {
        ...task,
        ...checked,
        localFields: [...localFields],
        updatedAt: new Date().toISOString(),
      });
      return this.snapshot();
    },
    deleteTask(id) {
      text(id, "Task ID", 100);
      db.prepare("DELETE FROM records WHERE id = ? AND type = 'task'").run(id);
      return this.snapshot();
    },
    addRoutine(input) {
      const checked = routineInput(input);
      if (checked.action === "sync" && !get(`course:${checked.courseId}`)) throw new Error("Choose a synced Moodle course.");
      const routine = {
        ...checked,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        cadence: "manual", nextRunAt: "",
      };
      save(routine.id, "routine", routine);
      return this.snapshot();
    },
    saveSettings(input) {
      save("settings", "meta", settingsInput(input, this.snapshot().settings));
      return this.snapshot();
    },
    setRoutineSchedule(id, cadence, now = Date.now()) {
      text(id, "Routine ID", 100);
      const routine = all("routine").find(item => item.id === id);
      if (!routine) throw new Error("Routine not found.");
      const intervals = { manual: 0, hourly: 3600000, daily: 86400000, weekly: 604800000 };
      if (!Object.hasOwn(intervals, cadence)) throw new Error("Choose a supported schedule.");
      save(id, "routine", { ...routine, cadence, nextRunAt: intervals[cadence] ? new Date(now + intervals[cadence]).toISOString() : "" });
      return this.snapshot();
    },
    recordRoutineRun(id, error = "", now = Date.now()) {
      const routine = all("routine").find(item => item.id === id);
      if (!routine) return;
      const interval = { hourly: 3600000, daily: 86400000, weekly: 604800000 }[routine.cadence];
      save(id, "routine", { ...routine, lastRunAt: new Date(now).toISOString(), lastError: String(error).slice(0, 500), nextRunAt: interval ? new Date(now + interval).toISOString() : "" });
    },
    addNotice(key, title, body, now = Date.now()) {
      const id = `notice:${text(key, "Notice key", 300)}`;
      const stamp = key.startsWith("deadline:") ? `delivered:${key}` : "";
      if (get(id) || (stamp && get(stamp))) return false;
      save(id, "notice", { id, title: text(title, "Notice title", 300), body: text(body, "Notice body", 4000), createdAt: new Date(now).toISOString(), read: false });
      if (stamp) save(stamp, "meta", { deliveredAt: new Date(now).toISOString() });
      // Keep delivery stamps independently so inbox trimming cannot resend reminders.
      const notices = all("notice");
      for (const item of notices.slice(0, -200)) db.prepare("DELETE FROM records WHERE id = ? AND type = 'notice'").run(item.id);
      return true;
    },
    markNoticesRead() {
      for (const notice of all("notice")) save(notice.id, "notice", { ...notice, read: true });
      return this.snapshot();
    },
    addDocument(input) {
      if (all("document").length >= 100) throw new Error("Remove a document before adding more (100 maximum).");
      const document = { id: randomUUID(), title: text(input?.title, "Document title", 200), course: text(input?.course, "Course", 200, true), content: text(input?.content, "Document text", 120000), createdAt: new Date().toISOString() };
      save(document.id, "document", document);
      return this.snapshot();
    },
    documents() { return all("document"); },
    deleteDocument(id) {
      text(id, "Document ID", 100);
      db.prepare("DELETE FROM records WHERE id = ? AND type = 'document'").run(id);
      return this.snapshot();
    },
    appendMessage(message) {
      const id = randomUUID();
      save(id, "message", { ...message, id, createdAt: new Date().toISOString() });
      for (const item of all("message").slice(0, -100)) db.prepare("DELETE FROM records WHERE id = ? AND type = 'message'").run(item.id);
    },
    clearMessages() {
      db.prepare("DELETE FROM records WHERE type = 'message'").run();
      return this.snapshot();
    },
    deleteRoutine(id) {
      text(id, "Routine ID", 100);
      db.prepare("DELETE FROM records WHERE id = ? AND type = 'routine'").run(
        id,
      );
      return this.snapshot();
    },
    cacheCourses(courses) {
      if (!Array.isArray(courses) || courses.length > 1000)
        throw new Error("Invalid course response.");
      const checked = courses.map((course) => ({
        id: numericId(course.id),
        name: text(course.name, "Course name"),
        url: moodleUrl(course.url),
        checkedAt: new Date().toISOString(),
      }));
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM records WHERE type = 'course'").run();
        for (const course of checked)
          save(`course:${course.id}`, "course", course);
        save("sync", "meta", { coursesAt: new Date().toISOString() });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return this.snapshot();
    },
    cacheAssignments(courseId, result) {
      numericId(courseId);
      const course = get(`course:${courseId}`);
      if (!course) throw new Error("Sync your courses first.");
      if (
        !Array.isArray(result.assignments) ||
        result.assignments.length > 2000
      )
        throw new Error("Invalid assignment response.");
      const checked = result.assignments.map((assignment) => {
        numericId(assignment.id);
        const id = `moodle:${courseId}:${assignment.id}`;
        const previous = get(id);
        const imported = {
          id,
          title: text(assignment.title, "Assignment title"),
          course: course.name,
          courseId,
          notes: assignment.detailsRead === false ? previous?.notes || "" : text(assignment.description || assignment.section, "Description", 4000, true),
          dueAt: assignment.detailsRead === false ? previous?.dueAt || "" : optionalDate(assignment.dueAt),
          opensAt: assignment.detailsRead === false ? previous?.opensAt || "" : optionalDate(assignment.opensAt),
          kind: ["exam", "quiz"].includes(assignment.kind) ? assignment.kind : "homework",
          deadlineEvidence: text(assignment.deadlineEvidence, "Date evidence", 1000, true),
          deadlineTimeZone: text(assignment.deadlineTimeZone, "Source time zone", 100, true),
          detailsRead: assignment.detailsRead === true,
          submissionStatus: ["submitted", "not_submitted", "draft", "attempt_finished", "in_progress"].includes(assignment.submissionStatus) ? assignment.submissionStatus : "unknown",
          completionEvidence: text(assignment.completionEvidence, "Completion evidence", 1000, true),
          completed: previous?.completed || false,
          source: "moodle",
          sourceUrl: moodleUrl(assignment.url),
          checkedAt: new Date().toISOString(),
        };
        // Refresh Moodle metadata while retaining fields the student has edited.
        for (const key of previous?.localFields || []) {
          if (["title", "course", "notes", "dueAt", "kind"].includes(key))
            imported[key] = previous[key];
        }
        if (previous?.localFields) imported.localFields = previous.localFields;
        if (previous?.updatedAt) imported.updatedAt = previous.updatedAt;
        return imported;
      });
      db.exec("BEGIN");
      try {
        // Keep previously seen assignments: a missing link does not establish deletion or completion.
        for (const task of checked) save(task.id, "task", task);
        save(`course:${courseId}`, "course", {
          ...course,
          assignmentsAt: new Date().toISOString(),
        });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return this.snapshot();
    },
    close() {
      db.close();
    },
  };
}
