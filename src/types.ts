export type TaskKind = "homework" | "exam" | "quiz" | "study";
export interface Task {
  id: string;
  title: string;
  course: string;
  notes: string;
  kind: TaskKind;
  dueAt: string;
  completed: boolean;
  source: "manual" | "moodle";
  sourceUrl: string;
  createdAt?: string;
  checkedAt?: string;
  opensAt?: string;
  deadlineEvidence?: string;
  deadlineTimeZone?: string;
  detailsRead?: boolean;
}
export interface Course {
  id: string;
  name: string;
  url: string;
  checkedAt: string;
  assignmentsAt?: string;
}
export interface Routine {
  id: string;
  name: string;
  course: string;
  instructions: string;
  createdAt: string;
  action?: "reminder" | "sync";
  courseId?: string;
  cadence?: Cadence;
  nextRunAt?: string;
  lastRunAt?: string;
  lastError?: string;
}
export type Cadence = "manual" | "hourly" | "daily" | "weekly";
export interface Settings {
  model: string;
  aiMode: "api-key" | "chatgpt";
  timeZone: string;
  remindersEnabled: boolean;
  reminderMinutes: number;
  backgroundEnabled: boolean;
}
export interface Material { id: string; title: string; course: string; createdAt: string; content?: string }
export interface Question { question: string; choices: string[]; answerIndex: number; explanation: string }
export interface ChatMessage { id: string; role: "user" | "assistant"; content: string; sources: { id: string; title: string; reference: string; sourceUrl?: string; excerpt?: string }[]; questions: Question[]; createdAt: string }
export interface Notice { id: string; title: string; body: string; read: boolean; createdAt: string }
export interface AiStatus {
  configured: boolean; fromEnvironment?: boolean; apiKeyConfigured?: boolean; mode?: "api-key" | "chatgpt";
  chatgpt?: { signedIn: boolean; planEnabled: boolean; account?: string; model: string; models: { id: string; name: string }[]; pending?: boolean; error?: string; welcomeRequired?: boolean };
}
export interface Snapshot {
  tasks: Task[];
  courses: Course[];
  routines: Routine[];
  sync: { coursesAt: string } | null;
  settings: Settings;
  documents: Material[];
  messages: ChatMessage[];
  notices: Notice[];
}
export type TaskInput = Pick<
  Task,
  "title" | "course" | "notes" | "kind" | "dueAt"
>;
export type RoutineInput = Pick<Routine, "name" | "course" | "instructions" | "action" | "courseId">;
export interface StudyApi {
  snapshot(): Promise<Snapshot>;
  saveSettings(input: Partial<Settings>): Promise<Snapshot>;
  aiStatus(): Promise<AiStatus>;
  connectAi(input: { key: string; model: string }): Promise<Snapshot>;
  disconnectAi(): Promise<Snapshot>;
  signInChatGpt(options?: { newAccount?: boolean; consent?: boolean }): Promise<Snapshot>;
  cancelChatGptSignIn(): Promise<Snapshot>;
  signOutChatGpt(): Promise<{ snapshot: Snapshot; warning?: string }>;
  refreshChatGptModels(): Promise<Snapshot>;
  selectChatGptModel(id: string): Promise<Snapshot>;
  acknowledgeChatGptWelcome(): Promise<Snapshot>;
  openChatGptUsage(): Promise<void>;
  sendMessage(input: { prompt: string; mode: "chat" | "quiz"; documentIds: string[]; includeTasks: boolean }): Promise<Snapshot>;
  cancelMessage(): Promise<void>;
  onProgress(callback: (value: string) => void): () => void;
  clearChat(): Promise<Snapshot>;
  addDocument(input: { title: string; course: string; content: string }): Promise<Snapshot>;
  deleteDocument(id: string): Promise<Snapshot>;
  searchDocuments(query: string): Promise<{ id: string; title: string; excerpt: string }[]>;
  importDocument(course: string): Promise<Snapshot>;
  onSnapshot(callback: (value: Snapshot) => void): () => void;
  onOpenSettings(callback: () => void): () => void;
  openSource(url: string): Promise<void>;
}
declare global {
  interface Window {
    study?: StudyApi;
  }
}
