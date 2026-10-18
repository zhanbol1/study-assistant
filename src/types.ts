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
  timeZone: string;
  remindersEnabled: boolean;
  reminderMinutes: number;
  backgroundEnabled: boolean;
}
export interface Material { id: string; title: string; course: string; createdAt: string; content?: string }
export interface Question { question: string; choices: string[]; answerIndex: number; explanation: string }
export interface ChatMessage { id: string; role: "user" | "assistant"; content: string; sources: { id: string; title: string; reference: string; excerpt?: string }[]; questions: Question[]; createdAt: string }
export interface Notice { id: string; title: string; body: string; read: boolean; createdAt: string }
export interface AiStatus { configured: boolean; fromEnvironment?: boolean }
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
  addTask(input: TaskInput): Promise<Snapshot>;
  updateTask(id: string, input: TaskInput): Promise<Snapshot>;
  toggleTask(id: string): Promise<Snapshot>;
  deleteTask(id: string): Promise<Snapshot>;
  addRoutine(input: RoutineInput): Promise<Snapshot>;
  deleteRoutine(id: string): Promise<Snapshot>;
  setRoutineSchedule(id: string, cadence: Cadence): Promise<Snapshot>;
  runRoutine(id: string): Promise<Snapshot>;
  saveSettings(input: Partial<Settings>): Promise<Snapshot>;
  markNoticesRead(): Promise<Snapshot>;
  aiStatus(): Promise<AiStatus>;
  connectAi(input: { key: string; model: string }): Promise<Snapshot>;
  disconnectAi(): Promise<Snapshot>;
  sendMessage(input: { prompt: string; mode: "chat" | "quiz"; documentIds: string[]; includeTasks: boolean }): Promise<Snapshot>;
  clearChat(): Promise<Snapshot>;
  addDocument(input: { title: string; course: string; content: string }): Promise<Snapshot>;
  deleteDocument(id: string): Promise<Snapshot>;
  searchDocuments(query: string): Promise<{ id: string; title: string; excerpt: string }[]>;
  importDocument(course: string): Promise<Snapshot>;
  onSnapshot(callback: (value: Snapshot) => void): () => void;
  syncCourses(): Promise<Snapshot>;
  syncAssignments(id: string): Promise<Snapshot>;
  openSource(url: string): Promise<void>;
}
declare global {
  interface Window {
    study?: StudyApi;
  }
}
