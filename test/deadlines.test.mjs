import test from "node:test";
import assert from "node:assert/strict";
import { parseMoodleDate, deadlineDetails } from "../lms-agent/src/browser/deadlines.js";
import { createStore } from "../desktop/store.mjs";

test("Moodle dates use the selected IANA zone and handle 12-hour clocks", () => {
  assert.equal(parseMoodleDate("Friday, 23 October 2026, 11:59 PM", "Asia/Bishkek"), "2026-10-23T17:59:00.000Z");
  assert.equal(parseMoodleDate("23 Oct 2026, 12:00 AM", "Asia/Bishkek"), "2026-10-22T18:00:00.000Z");
  assert.equal(parseMoodleDate("2026-10-23T18:00:00+06:00", "UTC"), "2026-10-23T12:00:00.000Z");
  assert.equal(parseMoodleDate("23 October 2026, 18:00", "UTC"), "2026-10-23T18:00:00.000Z");
});

test("unparseable, invalid, and ambiguous daylight-saving dates stay unknown", () => {
  for (const value of ["Tomorrow", "10/11/26 10:00", "31 February 2026, 10:00", "23 October 2026", "23 October 2026, 28:00", "23 October 2026, 0:00 PM"]) assert.equal(parseMoodleDate(value, "UTC"), "", value);
  assert.equal(parseMoodleDate("1 November 2026, 01:30", "America/New_York"), "");
  assert.equal(parseMoodleDate("8 March 2026, 02:30", "America/New_York"), "");
  assert.equal(parseMoodleDate("23 October 2026, 10:00", "Invalid/Zone"), "");
  assert.equal(parseMoodleDate("2026-02-30T10:00:00Z", "UTC"), "");
});

test("deadline extraction distinguishes opening, due, and cutoff dates and keeps evidence", () => {
  const result = deadlineDetails([
    { label: "Opens:", value: "23 October 2026, 09:00" },
    { label: "Due date", value: "23 October 2026, 18:00" },
    { label: "Cut-off date", value: "30 October 2026, 18:00" },
  ], "Asia/Bishkek");
  assert.equal(result.opensAt, "2026-10-23T03:00:00.000Z");
  assert.equal(result.dueAt, "2026-10-23T12:00:00.000Z");
  assert.match(result.deadlineEvidence, /Due date/);
  const quiz = deadlineDetails([{ label: "Closes:", value: "Translated display text", timestamp: "1792756800" }], "Asia/Bishkek");
  assert.equal(quiz.dueAt, new Date(1792756800000).toISOString());
  const conflicting = deadlineDetails([{ label: "Due:", value: "23 October 2026, 18:00" }, { label: "Due date", value: "24 October 2026, 18:00" }], "UTC");
  assert.equal(conflicting.dueAt, "");
  assert.match(conflicting.deadlineEvidence, /Conflicting/);
});

test("coursework imports persist explicit dates, quiz types, evidence, and local overrides", () => {
  const store = createStore(":memory:");
  const course = { id: "1", name: "Calculus", url: "https://ucasaslms.org/course/view.php?id=1" };
  const quiz = { id: "2", title: "Final exam", kind: "exam", dueAt: "2026-10-23T18:00:00+06:00", opensAt: "2026-10-23T16:00:00+06:00", description: "Differentiation", detailsRead: true, deadlineEvidence: "Closes: 23 October 2026, 18:00", url: "https://ucasaslms.org/mod/quiz/view.php?id=2" };
  try {
    store.cacheCourses([course]);
    let task = store.cacheAssignments("1", { assignments: [quiz] }).tasks[0];
    assert.equal(task.kind, "exam");
    assert.equal(task.dueAt, "2026-10-23T12:00:00.000Z");
    assert.equal(task.notes, "Differentiation");
    task = store.cacheAssignments("1", { assignments: [{ ...quiz, detailsRead: false, dueAt: undefined }] }).tasks[0];
    assert.equal(task.dueAt, "2026-10-23T12:00:00.000Z");
    store.updateTask(task.id, { ...task, dueAt: "2026-10-25T10:00:00Z", kind: "quiz" });
    task = store.cacheAssignments("1", { assignments: [quiz] }).tasks[0];
    assert.equal(task.dueAt, "2026-10-25T10:00:00.000Z");
    assert.equal(task.kind, "quiz");
    assert.throws(() => store.cacheAssignments("1", { assignments: [{ ...quiz, dueAt: "tomorrow" }] }));
    assert.equal(store.snapshot().tasks[0].dueAt, task.dueAt);
  } finally { store.close(); }
});
