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
}
export interface Snapshot {
  tasks: Task[];
  courses: Course[];
  routines: Routine[];
  sync: { coursesAt: string } | null;
}
export type TaskInput = Pick<
  Task,
  "title" | "course" | "notes" | "kind" | "dueAt"
>;
export type RoutineInput = Pick<Routine, "name" | "course" | "instructions">;
export interface StudyApi {
  snapshot(): Promise<Snapshot>;
  addTask(input: TaskInput): Promise<Snapshot>;
  updateTask(id: string, input: TaskInput): Promise<Snapshot>;
  toggleTask(id: string): Promise<Snapshot>;
  deleteTask(id: string): Promise<Snapshot>;
  addRoutine(input: RoutineInput): Promise<Snapshot>;
  deleteRoutine(id: string): Promise<Snapshot>;
  syncCourses(): Promise<Snapshot>;
  syncAssignments(id: string): Promise<Snapshot>;
  openSource(url: string): Promise<void>;
}
declare global {
  interface Window {
    study?: StudyApi;
  }
}
