import type { Snapshot, StudyApi, Settings } from "./types";

export const defaultSettings: Settings = { model: "gpt-4.1-mini", aiMode: "api-key", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, remindersEnabled: false, reminderMinutes: 60, backgroundEnabled: false };

const previewKey = "study-assistant-preview-v1";
function seed(): Snapshot {
  return { tasks: [], courses: [],
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
const previewApi: StudyApi = {
  snapshot: async () => read(),
  saveSettings: input => update(state => { state.settings = { ...state.settings, ...input }; }),
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
  cancelMessage: async () => {},
  onProgress: () => () => {},
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
  openSource: async (url) => {
    if (new URL(url).origin === "https://ucasaslms.org")
      window.open(url, "_blank", "noopener,noreferrer");
  },
};
export const isPreview = !window.study;
export const api = window.study || previewApi;
