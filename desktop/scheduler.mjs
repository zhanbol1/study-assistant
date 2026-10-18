export function createScheduler({ store, syncCourse, notify = () => {}, now = Date.now }) {
  let ticking = false;
  const running = new Set();
  async function deliver(key, title, body) {
    title = title.slice(0, 300);
    body = body.slice(0, 4000);
    if (store.addNotice(key, title, body, now())) {
      try { await notify(title, body); } catch { /* The persistent inbox is still available. */ }
    }
  }
  async function runRoutine(id) {
    if (running.has(id)) throw new Error("This routine is already running.");
    const routine = store.snapshot().routines.find(item => item.id === id);
    if (!routine) throw new Error("Routine not found.");
    running.add(id);
    try {
      if (routine.action === "sync") await syncCourse(routine.courseId);
      store.recordRoutineRun(id, "", now());
      await deliver(`routine:${id}:${now()}`, routine.name, routine.action === "sync" ? `Coursework checked. ${routine.instructions}` : routine.instructions);
      return store.snapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Routine failed.";
      store.recordRoutineRun(id, message, now());
      await deliver(`routine-error:${id}:${now()}`, `${routine.name} failed`, message);
      throw error;
    } finally { running.delete(id); }
  }
  return {
    runRoutine,
    async tick() {
      if (ticking) return;
      ticking = true;
      try {
        const snapshot = store.snapshot();
        if (snapshot.settings.remindersEnabled) {
          for (const task of snapshot.tasks) {
            const due = Date.parse(task.dueAt);
            if (task.completed || !Number.isFinite(due) || due < now() - 86400000 || due > now() + snapshot.settings.reminderMinutes * 60000) continue;
            const label = due <= now() ? "Overdue" : "Due soon";
            await deliver(`deadline:${task.id}:${task.dueAt}`, `${label}: ${task.title}`.slice(0, 300), `${task.course || "Personal study"} · ${new Date(due).toLocaleString()}`);
          }
        }
      } finally { ticking = false; }
      // Release reminder processing before waiting for a browser. Later ticks can
      // still deliver deadlines while the running set serializes coursework reads.
      for (const routine of store.snapshot().routines) {
        if (routine.cadence && routine.cadence !== "manual" && routine.nextRunAt && Date.parse(routine.nextRunAt) <= now() && !running.has(routine.id)) {
          if (routine.action === "sync" && running.size) continue;
          try { await runRoutine(routine.id); } catch { /* Recorded in the inbox and routine history. */ }
        }
      }
    },
  };
}
