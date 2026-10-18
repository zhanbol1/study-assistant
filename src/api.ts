import type { Snapshot, StudyApi, Settings } from "./types";

export const defaultSettings: Settings = { model: "gpt-4.1-mini", aiMode: "api-key", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, remindersEnabled: false, reminderMinutes: 60, backgroundEnabled: false };

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
    settings: { ...defaultSettings }, documents: [], messages: [], notices: [],
  };
}
function read(): Snapshot {
  try {
    const value = localStorage.getItem(previewKey);
    if (value) {
      const parsed = JSON.parse(value);
      return { ...seed(), ...parsed, settings: { ...defaultSettings, ...parsed.settings } };
    }
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
  updateTask: (id, input) =>
    update((state) => {
      const task = state.tasks.find((item) => item.id === id);
      if (!task) throw new Error("Task not found.");
      task.title = input.title;
      task.course = input.course;
      task.notes = input.notes;
      task.kind = input.kind;
      task.dueAt = input.dueAt;
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
  setRoutineSchedule: async () => { throw new Error("Scheduled routines require the desktop app."); },
  runRoutine: async () => { throw new Error("Run routines in the desktop app."); },
  saveSettings: input => update(state => { state.settings = { ...state.settings, ...input }; }),
  markNoticesRead: () => update(state => { state.notices.forEach(item => { item.read = true; }); }),
  aiStatus: async () => ({ configured: false }),
  connectAi: async () => { throw new Error("Connect OpenAI in the desktop app. API keys are never stored in the browser preview."); },
  disconnectAi: async () => read(),
  signInChatGpt: async () => { throw new Error("Continue with ChatGPT in the desktop app."); },
  cancelChatGptSignIn: async () => read(),
  signOutChatGpt: async () => ({ snapshot: read() }),
  refreshChatGptModels: async () => read(),
  selectChatGptModel: async () => read(),
  acknowledgeChatGptWelcome: async () => read(),
  openChatGptUsage: async () => { window.open("https://chatgpt.com/#settings/Usage", "_blank", "noopener,noreferrer"); },
  sendMessage: async () => { throw new Error("AI requests require the desktop app and an API connection."); },
  clearChat: () => update(state => { state.messages = []; }),
  addDocument: input => update(state => {
    if (!input.title.trim() || !input.content.trim() || input.content.length > 120000) throw new Error("Enter a title and up to 120000 characters of text.");
    state.documents.push({ id: crypto.randomUUID(), title: input.title.trim(), course: input.course.trim(), content: input.content, createdAt: new Date().toISOString() });
  }),
  deleteDocument: id => update(state => { state.documents = state.documents.filter(item => item.id !== id); }),
  searchDocuments: async query => read().documents.filter(doc => `${doc.title} ${doc.course} ${doc.content || ""}`.toLowerCase().includes(query.toLowerCase())).map(doc => ({ id: doc.id, title: doc.title, excerpt: (doc.content || "").slice(0, 400) })),
  importDocument: async () => { throw new Error("File import requires the desktop app. You can paste notes in this preview."); },
  onSnapshot: () => () => {},
  onOpenSettings: () => () => {},
  syncCourses: unavailable,
  syncAssignments: unavailable,
  openSource: async (url) => {
    if (new URL(url).origin === "https://ucasaslms.org")
      window.open(url, "_blank", "noopener,noreferrer");
  },
};
export const isPreview = !window.study;
export const api = window.study || previewApi;
