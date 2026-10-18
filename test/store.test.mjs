import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore } from "../desktop/store.mjs";
import { moodleUrl, numericId } from "../desktop/validation.mjs";

const input = {
  title: "Review derivatives",
  course: "Calculus",
  kind: "exam",
  dueAt: "2026-11-02T10:00:00+06:00",
  notes: "Chapters 1–3",
};
const course = {
  id: "1217",
  name: "Calculus",
  url: "https://ucasaslms.org/course/view.php?id=1217",
};
const assignment = {
  id: "501",
  title: "Problem set",
  section: "Week 5",
  url: "https://ucasaslms.org/mod/assign/view.php?id=501",
};

test("manual tasks and routines survive reopening the SQLite database", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "study-store-"));
  const filename = path.join(directory, "workspace.sqlite");
  let store;
  try {
    store = createStore(filename);
    const task = store.addTask(input).tasks[0];
    assert.equal(task.dueAt, "2026-11-02T04:00:00.000Z");
    store.toggleTask(task.id);
    store.updateTask(task.id, { ...input, title: "Review integrals", notes: "Updated notes" });
    store.addRoutine({
      name: "Check announcements",
      course: "Calculus",
      instructions: "Collect explicit due dates from new posts.",
    });
    store.close();
    store = createStore(filename);
    assert.equal(store.snapshot().tasks[0].completed, true);
    assert.equal(store.snapshot().tasks[0].title, "Review integrals");
    assert.equal(store.snapshot().tasks[0].notes, "Updated notes");
    assert.equal(store.snapshot().routines[0].name, "Check announcements");
    store.deleteTask(task.id);
    assert.equal(store.snapshot().tasks.length, 0);
  } finally {
    store?.close();
    for (const entry of fs.readdirSync(directory))
      fs.unlinkSync(path.join(directory, entry));
    fs.rmdirSync(directory);
  }
});

test("reimport deduplicates Moodle tasks, preserves local completion, and leaves dates unknown", () => {
  const store = createStore(":memory:");
  try {
    store.cacheCourses([course]);
    const first = store.cacheAssignments("1217", { assignments: [assignment] })
      .tasks[0];
    assert.equal(first.dueAt, "");
    store.toggleTask(first.id);
    const next = store.cacheAssignments("1217", {
      assignments: [{ ...assignment, title: "Updated problem set" }],
    });
    assert.equal(next.tasks.length, 1);
    assert.equal(next.tasks[0].completed, true);
    assert.equal(next.tasks[0].title, "Updated problem set");
    assert.equal(
      store.cacheAssignments("1217", { assignments: [] }).tasks.length,
      1,
    );
  } finally {
    store.close();
  }
});

test("invalid sync payloads cannot destroy the last successful course snapshot", () => {
  const store = createStore(":memory:");
  try {
    store.cacheCourses([course]);
    assert.throws(() =>
      store.cacheCourses([
        { ...course, url: "https://evil.example/course/view.php?id=1217" },
      ]),
    );
    assert.equal(store.snapshot().courses[0].id, "1217");
    assert.throws(() =>
      store.cacheAssignments("1217", {
        assignments: [assignment, { ...assignment, id: "bad" }],
      }),
    );
    assert.equal(store.snapshot().tasks.length, 0);
  } finally {
    store.close();
  }
});

test("edited Moodle fields survive imports while untouched fields refresh", () => {
  const store = createStore(":memory:");
  try {
    store.cacheCourses([course]);
    const task = store.cacheAssignments(course.id, { assignments: [assignment] }).tasks[0];
    store.toggleTask(task.id);
    store.updateTask(task.id, {
      ...task, notes: "My study notes", dueAt: input.dueAt, kind: "quiz",
      id: "injected", source: "manual", sourceUrl: "https://evil.example",
    });
    let updated = store.cacheAssignments(course.id, {
      assignments: [{ ...assignment, title: "New Moodle title", section: "New section" }],
    }).tasks[0];
    assert.equal(updated.title, "New Moodle title");
    assert.equal(updated.notes, "My study notes");
    assert.equal(updated.dueAt, "2026-11-02T04:00:00.000Z");
    assert.equal(updated.kind, "quiz");
    assert.equal(updated.completed, true);
    assert.equal(updated.id, task.id);
    assert.equal(updated.source, "moodle");
    assert.equal(updated.sourceUrl, assignment.url);
    store.updateTask(task.id, { ...updated, dueAt: "", notes: "" });
    updated = store.cacheAssignments(course.id, { assignments: [assignment] }).tasks[0];
    assert.equal(updated.dueAt, "");
    assert.equal(updated.notes, "");
    assert.throws(() => store.updateTask(task.id, { ...updated, title: " " }));
    assert.deepEqual(store.snapshot().tasks[0], updated);
    assert.throws(() => store.updateTask("course:1217", input), /Task not found/);
    assert.throws(() => store.updateTask("missing", input), /Task not found/);
  } finally {
    store.close();
  }
});

test("validates writes and restricts external navigation to Moodle module links", () => {
  const store = createStore(":memory:");
  try {
    assert.throws(() => store.addTask({ ...input, title: " " }));
    assert.throws(() => store.addTask({ ...input, dueAt: "tomorrow" }));
    assert.throws(() => store.addTask({ ...input, kind: "shell" }));
    assert.throws(() => store.addRoutine({ name: "Test", instructions: "" }));
    assert.throws(() => numericId("../1"));
    assert.throws(() => moodleUrl("file:///C:/Windows/notepad.exe"));
    assert.throws(() =>
      moodleUrl("https://ucasaslms.org/login/logout.php?id=1"),
    );
    assert.throws(() =>
      moodleUrl("https://ucasaslms.org.evil.example/course/view.php?id=1"),
    );
    assert.equal(
      moodleUrl(course.url + "&sesskey=secret#fragment"),
      course.url,
    );
  } finally {
    store.close();
  }
});
