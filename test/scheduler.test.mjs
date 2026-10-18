import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore } from "../desktop/store.mjs";
import { createScheduler } from "../desktop/scheduler.mjs";

const now = Date.parse("2026-10-18T10:00:00Z");
const task = { title: "Problem set", kind: "homework", dueAt: "2026-10-18T10:30:00Z", notes: "", course: "Calculus" };

test("deadline reminders are opt-in, deduplicate, skip completed tasks, and catch up after sleep", async () => {
  const store = createStore(":memory:");
  let clock = now;
  const notifications = [];
  const scheduler = createScheduler({ store, now: () => clock, notify: (title, body) => notifications.push({ title, body }) });
  try {
    store.addTask(task);
    const complete = store.addTask({ ...task, title: "Completed" }).tasks[1];
    store.toggleTask(complete.id);
    store.addTask({ ...task, title: "No date", dueAt: "" });
    store.addTask({ ...task, title: "Future", dueAt: "2026-10-25T10:30:00Z" });
    await scheduler.tick();
    assert.equal(notifications.length, 0);
    store.saveSettings({ remindersEnabled: true });
    await scheduler.tick(); await scheduler.tick();
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].title, /^Due soon:/);
    clock += 2 * 3600000;
    await scheduler.tick();
    assert.equal(notifications.length, 1);
    store.addTask({ ...task, title: "Missed while asleep", dueAt: new Date(clock - 60000).toISOString() });
    await scheduler.tick();
    assert.match(notifications[1].title, /^Overdue:/);
    store.markNoticesRead();
    assert.ok(store.snapshot().notices.every(notice => notice.read));
  } finally { store.close(); }
});

test("scheduled checks serialize, catch up once, and retain errors without retry storms", async () => {
  const store = createStore(":memory:");
  let clock = now;
  let calls = 0;
  let fail = false;
  const scheduler = createScheduler({ store, now: () => clock, syncCourse: async id => { calls++; assert.equal(id, "1"); if (fail) throw new Error("Login required."); } });
  try {
    store.cacheCourses([{ id: "1", name: "Calculus", url: "https://ucasaslms.org/course/view.php?id=1" }]);
    const routine = store.addRoutine({ name: "Check coursework", instructions: "Read deadlines", action: "sync", courseId: "1" }).routines[0];
    store.setRoutineSchedule(routine.id, "hourly", clock);
    await scheduler.tick(); assert.equal(calls, 0);
    clock += 10 * 3600000;
    await Promise.all([scheduler.tick(), scheduler.tick()]);
    assert.equal(calls, 1);
    assert.equal(store.snapshot().routines[0].nextRunAt, new Date(clock + 3600000).toISOString());
    fail = true; clock += 3600000;
    await scheduler.tick(); await scheduler.tick();
    assert.equal(calls, 2);
    assert.equal(store.snapshot().routines[0].lastError, "Login required.");
    assert.match(store.snapshot().notices.at(-1).title, /failed/);
    store.setRoutineSchedule(routine.id, "manual", clock);
    clock += 3600000; await scheduler.tick(); assert.equal(calls, 2);
    assert.throws(() => store.setRoutineSchedule(routine.id, "every second"));
    assert.throws(() => store.addRoutine({ name: "Invalid", instructions: "x", action: "shell" }));
    assert.throws(() => store.addRoutine({ name: "Invalid", instructions: "x", action: "sync", courseId: "2" }));
  } finally { store.close(); }
});

test("settings, schedules and reminder deduplication survive restart even when notifications fail", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "study-scheduler-"));
  let store = createStore(path.join(folder, "workspace.sqlite"));
  try {
    store.addTask(task);
    store.saveSettings({ remindersEnabled: true, backgroundEnabled: true, timeZone: "Asia/Bishkek" });
    const routine = store.addRoutine({ name: "Study", instructions: "Review derivatives" }).routines[0];
    store.setRoutineSchedule(routine.id, "daily", now);
    await createScheduler({ store, now: () => now, notify: () => { throw new Error("Notifications unavailable"); } }).tick();
    assert.equal(store.snapshot().notices.length, 1);
    store.close(); store = createStore(path.join(folder, "workspace.sqlite"));
    await createScheduler({ store, now: () => now, notify: () => assert.fail("Duplicate reminder") }).tick();
    assert.equal(store.snapshot().notices.length, 1);
    assert.equal(store.snapshot().settings.backgroundEnabled, true);
    assert.equal(store.snapshot().routines[0].cadence, "daily");
    assert.throws(() => store.saveSettings({ remindersEnabled: "yes" }));
    assert.throws(() => store.saveSettings({ reminderMinutes: 0 }));
    assert.throws(() => store.saveSettings({ timeZone: "Not/AZone" }));
  } finally { store.close(); fs.rmSync(folder, { recursive: true }); }
});

test("long Moodle checks do not block deadline reminders on later ticks", async () => {
  const store = createStore(":memory:");
  let release;
  let clock = now;
  const scheduler = createScheduler({ store, now: () => clock, syncCourse: () => new Promise(resolve => { release = resolve; }) });
  try {
    store.cacheCourses([{ id: "1", name: "Calculus", url: "https://ucasaslms.org/course/view.php?id=1" }]);
    const routine = store.addRoutine({ name: "Slow check", instructions: "x", action: "sync", courseId: "1" }).routines[0];
    store.setRoutineSchedule(routine.id, "hourly", now - 3600000);
    const pending = scheduler.tick();
    store.addTask(task);
    store.saveSettings({ remindersEnabled: true });
    clock += 60000;
    await scheduler.tick();
    assert.ok(store.snapshot().notices.some(notice => notice.title.includes("Problem set")));
    release(); await pending;
  } finally { store.close(); }
});

test("inbox trimming cannot cause old deadline reminders to be delivered again", async () => {
  const store = createStore(":memory:");
  try {
    assert.equal(store.addNotice("deadline:task:date", "Due soon", "Review notes", now), true);
    for (let index = 0; index < 201; index++) store.addNotice(`routine:${index}`, "Routine", "Done", now);
    assert.equal(store.snapshot().notices.length, 200);
    assert.equal(store.addNotice("deadline:task:date", "Due soon", "Review notes", now), false);
  } finally { store.close(); }
});
