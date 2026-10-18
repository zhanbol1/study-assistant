import type { Snapshot, StudyApi } from "./types";

const previewKey = "study-assistant-preview-v1";
function seed(): Snapshot {
  const due = (days: number, hour: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  };
  return {
    tasks: [
      {
        id: "preview-1",
        title: "Problem set: derivatives & applications",
        course: "Calculus II",
        kind: "homework",
        notes:
          "Practice problems 1–12. Review the chain rule before you begin.",
        dueAt: due(1, 18),
        completed: false,
        source: "manual",
        sourceUrl: "",
      },
      {
        id: "preview-2",
        title: "Prepare for the midterm",
        course: "Introduction to Computer Science",
        kind: "exam",
        notes: "Arrays, functions, and algorithm complexity.",
        dueAt: due(3, 10),
        completed: false,
        source: "manual",
        sourceUrl: "",
      },
      {
        id: "preview-3",
        title: "Read chapter 4 & write a response",
        course: "Academic Writing",
        kind: "homework",
        notes: "",
        dueAt: due(4, 16),
        completed: false,
        source: "manual",
        sourceUrl: "",
      },
    ],
    courses: [],
    routines: [],
    sync: null,
  };
}
function read(): Snapshot {
  try {
    const value = localStorage.getItem(previewKey);
    if (value) return JSON.parse(value);
  } catch {
    /* reset malformed preview data */
  }
  return seed();
}
function update(change: (state: Snapshot) => void): Promise<Snapshot> {
  const state = read();
  change(state);
  localStorage.setItem(previewKey, JSON.stringify(state));
  return Promise.resolve(state);
}
const unavailable = async (): Promise<never> => {
  throw new Error(
    "Moodle sync is available in the desktop app. Run npm start from your terminal.",
  );
};
const previewApi: StudyApi = {
  snapshot: async () => read(),
  addTask: (input) =>
    update((state) =>
      state.tasks.push({
        ...input,
        id: crypto.randomUUID(),
        completed: false,
        source: "manual",
        sourceUrl: "",
        createdAt: new Date().toISOString(),
      }),
    ),
  toggleTask: (id) =>
    update((state) => {
      const task = state.tasks.find((item) => item.id === id);
      if (task) task.completed = !task.completed;
    }),
  deleteTask: (id) =>
    update((state) => {
      state.tasks = state.tasks.filter((item) => item.id !== id);
    }),
  addRoutine: (input) =>
    update((state) =>
      state.routines.push({
        ...input,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      }),
    ),
  deleteRoutine: (id) =>
    update((state) => {
      state.routines = state.routines.filter((item) => item.id !== id);
    }),
  syncCourses: unavailable,
  syncAssignments: unavailable,
  openSource: async (url) => {
    if (new URL(url).origin === "https://ucasaslms.org")
      window.open(url, "_blank", "noopener,noreferrer");
  },
};
export const isPreview = !window.study;
export const api = window.study || previewApi;
