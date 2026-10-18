import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  taskInput,
  routineInput,
  text,
  numericId,
  moodleUrl,
} from "./validation.mjs";

export function createStore(filename) {
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
      };
    },
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
      const routine = {
        ...routineInput(input),
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      save(routine.id, "routine", routine);
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
          notes: text(assignment.section, "Section", 300, true),
          dueAt: "",
          kind: "homework",
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
