import type { Snapshot, StudyApi, Settings } from "./types";

export const defaultSettings: Settings = { model: "gpt-4.1-mini", aiMode: "api-key", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, remindersEnabled: false, reminderMinutes: 60, backgroundEnabled: false };

const previewKey = "study-assistant-preview-v1";
function seed(): Snapshot {
  return { tasks: [], courses: [],
    memory: { content: "# My study instructions\n\nWrite your course rules and study preferences here.\n", revision: "initial" }, pages: [], downloads: [],
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
  saveMemory: (content, revision) => update(state => {
    if (state.memory.revision !== revision) throw new Error("Memory changed. Reload before saving.");
    if (content.length > 20000) throw new Error("Memory is limited to 20,000 characters.");
    state.memory = { content, revision: crypto.randomUUID() };
  }),
  revealMemory: async () => { throw new Error("The memory.md file is available in the desktop app."); },
  savePage: input => update(state => {
    const previous = state.pages.find(page => page.id === input.id);
    if (input.id && (!previous || previous.revision !== input.revision)) throw new Error("Page changed. Reload before saving.");
    if (!input.title.trim() || input.title.length > 100 || input.content.length > 30000) throw new Error("Enter a title and up to 30,000 characters of text.");
    if (!previous && state.pages.length >= 50) throw new Error("You can save up to 50 pages.");
    const page = { ...input, id: previous?.id || crypto.randomUUID(), revision: crypto.randomUUID(), sources: input.sources || [], createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (previous) state.pages[state.pages.indexOf(previous)] = page; else state.pages.push(page);
  }),
  deletePage: (id, revision) => update(state => {
    const page = state.pages.find(page => page.id === id);
    if (!page || page.revision !== revision) throw new Error("Page changed. Reload before deleting.");
    state.pages = state.pages.filter(page => page.id !== id);
  }),
  revealDownload: async () => { throw new Error("Downloaded files are available in the desktop app."); },
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
