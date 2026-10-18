import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  ExternalLink,
  FileText,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { api, isPreview, defaultSettings } from "./api";
import { AssistantPanel } from "./AssistantPanel";
import { ConnectionSettings } from "./ConnectionSettings";
import type { Snapshot, Task, TaskKind, Cadence } from "./types";

type Page =
  | "Overview"
  | "Homework"
  | "Exams & quizzes"
  | "Courses"
  | "Study routines"
  | "Assistant"
  | "Settings";
const nav = [
  { page: "Overview", icon: LayoutDashboard },
  { page: "Homework", icon: ListChecks },
  { page: "Exams & quizzes", icon: CalendarDays },
  { page: "Courses", icon: BookOpen },
  { page: "Study routines", icon: Workflow },
  { page: "Assistant", icon: Sparkles },
] as const;
const empty: Snapshot = { tasks: [], courses: [], routines: [], sync: null, settings: defaultSettings, documents: [], messages: [], notices: [] };
const kindLabels: Record<TaskKind, string> = {
  homework: "Homework",
  exam: "Exam",
  quiz: "Quiz",
  study: "Study session",
};
const dayKey = (date: Date) =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
function formatDate(value: string, includeTime = false) {
  if (!value) return "No deadline recorded";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}
function deadlineLabel(task: Task) {
  if (!task.dueAt) return task.source === "moodle" ? "Check deadline in Moodle" : "No deadline";
  const date = new Date(task.dueAt);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (dayKey(date) === dayKey(today)) return `Today, ${time}`;
  if (dayKey(date) === dayKey(tomorrow)) return `Tomorrow, ${time}`;
  return formatDate(task.dueAt, true);
}

function localDateTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function App() {
  const [page, setPage] = useState<Page>("Overview");
  const [state, setState] = useState<Snapshot>(empty);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"active" | "completed" | "all">(
    "active",
  );
  const [selectedDay, setSelectedDay] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [modal, setModal] = useState<"task" | "routine" | null>(null);
  const [detail, setDetail] = useState<Task | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  useEffect(() => {
    return api.onSnapshot(setState);
  }, []);
  useEffect(() => {
    let active = true;
    api
      .snapshot()
      .then((value) => {
        if (active) setState(value);
      })
      .catch((cause) => {
        if (active) setError(String(cause.message));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function perform(label: string, action: () => Promise<Snapshot>) {
    setBusy(label);
    setError("");
    try {
      setState(await action());
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Something went wrong. Please try again.",
      );
      return false;
    } finally {
      setBusy("");
    }
  }
  async function openSource(url: string) {
    try {
      await api.openSource(url);
    } catch {
      setError("The source link could not be opened.");
    }
  }
  const today = new Date();
  const activeTasks = state.tasks.filter((task) => !task.completed);
  const weekEnd = new Date();
  weekEnd.setDate(today.getDate() + 7);
  const dueWeek = activeTasks.filter(
    (task) =>
      task.dueAt &&
      new Date(task.dueAt) >= today &&
      new Date(task.dueAt) <= weekEnd,
  );
  const upcoming = [...activeTasks]
    .filter((task) => task.dueAt)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const next = upcoming.find((task) => new Date(task.dueAt) >= today);
  const visibleTasks = state.tasks
    .filter((task) => {
      if (page === "Homework" && task.kind !== "homework") return false;
      if (page === "Exams & quizzes" && !["exam", "quiz"].includes(task.kind))
        return false;
      if (
        (filter === "active" && task.completed) ||
        (filter === "completed" && !task.completed)
      )
        return false;
      if (
        selectedDay &&
        (!task.dueAt || dayKey(new Date(task.dueAt)) !== selectedDay)
      )
        return false;
      return `${task.title} ${task.course} ${task.notes}`
        .toLowerCase()
        .includes(search.toLowerCase());
    })
    .sort(
      (a, b) =>
        Number(a.completed) - Number(b.completed) ||
        (a.dueAt || "z").localeCompare(b.dueAt || "z"),
    );
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(today.getDate() + index + weekOffset * 7);
    return date;
  });
  const taskPage = ["Overview", "Homework", "Exams & quizzes"].includes(page);
  function navigate(value: Page) {
    setPage(value);
    setSearch("");
    setSelectedDay("");
    setFilter("active");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            navigate("Overview");
          }}
        >
          <span className="brand-icon">
            <GraduationCap size={24} />
          </span>
          <span>
            study<span className="brand-light">space</span>
            <small>YOUR STUDY ASSISTANT</small>
          </span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map(({ page: item, icon: Icon }) => (
            <button
              key={item}
              className={`nav-item ${page === item ? "selected" : ""}`}
              onClick={() => navigate(item)}
              aria-current={page === item ? "page" : undefined}
            >
              <Icon size={19} />
              <span>{item}</span>
              {item === "Homework" &&
                activeTasks.filter((task) => task.kind === "homework").length >
                  0 && (
                  <span className="nav-count">
                    {
                      activeTasks.filter((task) => task.kind === "homework")
                        .length
                    }
                  </span>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-card">
            <span className="connection-icon">
              <BookOpen size={17} />
            </span>
            <div>
              <strong>UCA Moodle</strong>
              <small>
                {state.sync ? "Saved course connection" : "Ready to connect"}
              </small>
            </div>
            <span className={`status-dot ${state.sync ? "connected" : ""}`} />
          </div>
          <button
            className={`nav-item ${page === "Settings" ? "selected" : ""}`}
            onClick={() => navigate("Settings")}
          >
            <Settings2 size={19} />
            Settings & connections
          </button>
          <div className="profile">
            <div className="avatar">S</div>
            <div>
              <strong>My workspace</strong>
              <small>
                {isPreview ? "Browser preview" : "Stored on this device"}
              </small>
            </div>
            <span className="local-badge">LOCAL</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <span>{page}</span>
          </div>
          <div className="topbar-right">
            {!!state.notices.filter(notice => !notice.read).length && <button className="text-button" onClick={() => navigate("Settings")}>{state.notices.filter(notice => !notice.read).length} new reminders</button>}
            <span className="local-indicator">
              <span />
              {isPreview ? "Preview · sample data" : "Local workspace"}
            </span>
            <button
              className="icon-button"
              aria-label="Setup and help"
              onClick={() => navigate("Settings")}
            >
              <CircleHelp size={19} />
            </button>
            <div className="avatar small">S</div>
          </div>
        </header>
        <main>
          {isPreview && (
            <div className="preview-note">
              Browser preview with sample tasks. Changes stay in this browser.
              Open the desktop app to connect to Moodle.
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {today.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </div>
              <h1>
                {page === "Overview"
                  ? "A little clarity. A better study day."
                  : page}
              </h1>
              <p>
                {page === "Overview"
                  ? "Your coursework, deadlines, and next steps. All in one place."
                  : page === "Homework"
                    ? "Keep track of what needs doing, one assignment at a time."
                    : page === "Exams & quizzes"
                      ? "Make room to prepare, before the date arrives."
                      : page === "Courses"
                        ? "Bring your Moodle courses into your own study workspace."
                        : page === "Study routines"
                          ? "Write down where to look and how you like to study."
                          : page === "Assistant"
                            ? "Ask questions, explore your materials, and practice what you learn."
                            : "Your workspace, your connections, your data."}
              </p>
            </div>
            {taskPage && (
              <button
                className="button primary"
                onClick={() => setModal("task")}
              >
                <Plus size={17} />
                Add task
              </button>
            )}
            {page === "Courses" && (
              <button
                disabled={!!busy}
                className="button primary"
                onClick={() => void perform("Syncing courses", api.syncCourses)}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <ArrowDownToLine size={17} />
                )}
                Sync courses
              </button>
            )}
            {page === "Study routines" && (
              <button
                className="button primary"
                onClick={() => setModal("routine")}
              >
                <Plus size={17} />
                New routine
              </button>
            )}
          </div>

          {loading ? (
            <div className="empty-state">
              <LoaderCircle className="spin" />
              <h2>Opening your workspace…</h2>
            </div>
          ) : (
            <>
              {taskPage && (
                <>
                  <section className="stats-grid" aria-label="Study summary">
                    <Stat
                      icon={<ListChecks size={19} />}
                      label="Open tasks"
                      value={activeTasks.length}
                      sub="One step at a time"
                      color="purple"
                    />
                    <Stat
                      icon={<Clock3 size={19} />}
                      label="Due in the next 7 days"
                      value={dueWeek.length}
                      sub="Based on recorded deadlines"
                      color="amber"
                    />
                    <Stat
                      icon={<GraduationCap size={20} />}
                      label="Exams & quizzes"
                      value={
                        activeTasks.filter((task) =>
                          ["exam", "quiz"].includes(task.kind),
                        ).length
                      }
                      sub="On your study radar"
                      color="blue"
                    />
                    <Stat
                      icon={<CheckCheck size={19} />}
                      label="Completed"
                      value={
                        state.tasks.filter((task) => task.completed).length
                      }
                      sub="Progress worth noticing"
                      color="green"
                    />
                  </section>
                  <div className="dashboard-grid">
                    <div className="dashboard-main">
                      <section className="panel week-panel">
                        <div className="panel-heading">
                          <h2>Your week, at a glance</h2>
                          <div className="week-controls">
                            <button
                              className="text-button"
                              onClick={() => {
                                setWeekOffset(0);
                                setSelectedDay("");
                              }}
                            >
                              Today
                            </button>
                            <button
                              className="icon-button"
                              aria-label="Previous week"
                              onClick={() =>
                                setWeekOffset((value) => value - 1)
                              }
                            >
                              <ChevronLeft size={17} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label="Next week"
                              onClick={() =>
                                setWeekOffset((value) => value + 1)
                              }
                            >
                              <ChevronRight size={17} />
                            </button>
                          </div>
                        </div>
                        <div className="week-strip">
                          {days.map((date) => {
                            const key = dayKey(date);
                            const count = activeTasks.filter(
                              (task) =>
                                task.dueAt &&
                                dayKey(new Date(task.dueAt)) === key,
                            ).length;
                            return (
                              <button
                                key={key}
                                className={`day ${key === dayKey(today) ? "today" : ""} ${selectedDay === key ? "chosen" : ""}`}
                                onClick={() =>
                                  setSelectedDay(selectedDay === key ? "" : key)
                                }
                                aria-pressed={selectedDay === key}
                                aria-label={`${date.toLocaleDateString()}, ${count} tasks`}
                              >
                                <span>
                                  {date.toLocaleDateString(undefined, {
                                    weekday: "short",
                                  })}
                                </span>
                                <strong>{date.getDate()}</strong>
                                <span className="day-dots">
                                  {count > 0 ? (
                                    <>
                                      <i />
                                      {count > 1 && <i />}
                                      {count > 2 && <i />}
                                    </>
                                  ) : (
                                    <b>—</b>
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                      <section className="panel tasks-panel">
                        <div className="panel-heading">
                          <div className="heading-with-count">
                            <h2>
                              {page === "Exams & quizzes"
                                ? "Your exams & quizzes"
                                : page === "Homework"
                                  ? "Your homework"
                                  : "On your list"}
                            </h2>
                            <span className="count-pill">
                              {visibleTasks.length}
                            </span>
                          </div>
                          {selectedDay && (
                            <button
                              className="text-button"
                              onClick={() => setSelectedDay("")}
                            >
                              Clear date filter <X size={13} />
                            </button>
                          )}
                        </div>
                        <div className="task-toolbar">
                          <div className="tabs" aria-label="Task status">
                            {(["active", "completed", "all"] as const).map(
                              (value) => (
                                <button
                                  key={value}
                                  className={filter === value ? "active" : ""}
                                  onClick={() => setFilter(value)}
                                  aria-pressed={filter === value}
                                >
                                  {value === "active"
                                    ? "To do"
                                    : value === "completed"
                                      ? "Completed"
                                      : "All tasks"}
                                </button>
                              ),
                            )}
                          </div>
                          <label className="search">
                            <Search size={15} />
                            <input
                              aria-label="Search tasks"
                              placeholder="Find a task…"
                              value={search}
                              onChange={(event) =>
                                setSearch(event.target.value)
                              }
                            />
                          </label>
                        </div>
                        {visibleTasks.length === 0 ? (
                          <Empty
                            icon={<CheckCheck size={27} />}
                            title={
                              state.tasks.length
                                ? "A clear space"
                                : "Make space for your next step"
                            }
                            description={
                              state.tasks.length
                                ? "No tasks match this view. Try another filter or add something new."
                                : "Add your first homework, exam, or study session. You can also import assignment links from Moodle."
                            }
                            action={
                              <button
                                className="button secondary"
                                onClick={() => setModal("task")}
                              >
                                <Plus size={16} />
                                Add a task
                              </button>
                            }
                          />
                        ) : (
                          <div className="task-list">
                            {visibleTasks.map((task) => (
                              <div
                                className={`task-row ${task.completed ? "completed" : ""}`}
                                key={task.id}
                              >
                                <button
                                  className="task-check"
                                  aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
                                  disabled={!!busy}
                                  onClick={() =>
                                    void perform("Saving task", () =>
                                      api.toggleTask(task.id),
                                    )
                                  }
                                >
                                  {task.completed && <Check size={14} />}
                                </button>
                                <button
                                  className="task-info"
                                  onClick={() => setDetail(task)}
                                >
                                  <span className="course-caption">
                                    <span
                                      className={`course-dot ${task.kind}`}
                                    />
                                    {task.course || "Personal study"}
                                  </span>
                                  <strong>{task.title}</strong>
                                  <span
                                    className={`task-deadline ${task.dueAt && new Date(task.dueAt) < today && !task.completed ? "overdue" : ""}`}
                                  >
                                    <Clock3 size={12} />
                                    {deadlineLabel(task)}
                                  </span>
                                </button>
                                <span className={`kind-badge ${task.kind}`}>
                                  {kindLabels[task.kind]}
                                </span>
                                <button
                                  className="icon-button task-arrow"
                                  aria-label={`View ${task.title}`}
                                  onClick={() => setDetail(task)}
                                >
                                  <ArrowUpRight size={17} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="panel-footnote">
                          <span className="status-dot connected" />
                          {state.sync
                            ? `Courses last checked ${formatDate(state.sync.coursesAt, true)}`
                            : "Tasks stay on this device"}
                          <span>Moodle deadlines are not imported yet</span>
                        </div>
                      </section>
                    </div>
                    <aside className="right-column">
                      <section className="focus-card">
                        <div className="focus-label">
                          <span className="sparkle-tile">
                            <Sparkles size={19} />
                          </span>
                          ONE THING AT A TIME
                        </div>
                        <h2>
                          {next
                            ? "Your next step starts here."
                            : "Give your day a little direction."}
                        </h2>
                        <p>
                          {next
                            ? "The next recorded deadline in your workspace."
                            : "Add a task or connect your courses to see what comes next."}
                        </p>
                        {next && (
                          <div className="focus-task">
                            <span>{next.course || "Personal study"}</span>
                            <strong>{next.title}</strong>
                            <small>
                              <Clock3 size={13} />
                              {deadlineLabel(next)}
                            </small>
                          </div>
                        )}
                        <button
                          className="button focus-button"
                          onClick={() =>
                            next ? setDetail(next) : setModal("task")
                          }
                        >
                          {next ? "Take a closer look" : "Plan your first task"}
                          <ArrowRight size={16} />
                        </button>
                        <div className="focus-decoration" aria-hidden="true">
                          ✳
                        </div>
                      </section>
                      <section className="panel connection-panel">
                        <div className="connection-panel-icon">
                          <BookOpen size={21} />
                        </div>
                        <h2>Your courses, connected.</h2>
                        <p>
                          Bring assignment links from UCA Moodle into your
                          workspace.
                        </p>
                        <button
                          className="button secondary full-width"
                          onClick={() => navigate("Courses")}
                        >
                          View courses <ArrowRight size={15} />
                        </button>
                        <span className="small-note">
                          You choose when to sync.
                        </span>
                      </section>
                      <button
                        className="routine-prompt"
                        onClick={() => navigate("Study routines")}
                      >
                        <Workflow size={21} />
                        <span>
                          <strong>Study your way</strong>
                          <small>Schedule coursework checks and study reminders</small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    </aside>
                  </div>
                </>
              )}

              {page === "Courses" && (
                <>
                  <div className="info-banner">
                    <BookOpen size={19} />
                    <span>
                      Uses the existing Moodle agent and credentials stored on
                      your Windows account. A browser will open during sync.{" "}
                      {state.sync
                        ? `Last course check: ${formatDate(state.sync.coursesAt, true)}.`
                        : "Complete the one-time setup in Settings before your first sync."}
                    </span>
                    <button
                      className="text-button"
                      onClick={() => navigate("Settings")}
                    >
                      Setup <ArrowRight size={14} />
                    </button>
                  </div>
                  {busy && (
                    <div className="sync-status" role="status">
                      <LoaderCircle size={17} className="spin" />
                      {busy}… Finish any login steps in the browser. This may
                      take a few minutes.
                    </div>
                  )}
                  {state.courses.length ? (
                    <div className="course-grid">
                      {state.courses
                        .filter((course) =>
                          course.name
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                        )
                        .map((course, index) => (
                          <section
                            className="panel course-card"
                            key={course.id}
                          >
                            <div className={`course-symbol tone-${index % 3}`}>
                              <BookOpen size={25} />
                            </div>
                            <span className="course-id">
                              MOODLE · {course.id}
                            </span>
                            <h2>{course.name}</h2>
                            <p>
                              {course.assignmentsAt
                                ? `Assignments checked ${formatDate(course.assignmentsAt, true)}`
                                : "Assignments have not been checked yet."}
                            </p>
                            <div className="course-actions">
                              <button
                                className="button secondary"
                                disabled={!!busy}
                                onClick={() =>
                                  void perform(`Reading ${course.name}`, () =>
                                    api.syncAssignments(course.id),
                                  )
                                }
                              >
                                <ArrowDownToLine size={15} />
                                Import coursework
                              </button>
                              <button
                                className="icon-button"
                                aria-label={`Open ${course.name} in Moodle`}
                                onClick={() => void openSource(course.url)}
                              >
                                <ExternalLink size={17} />
                              </button>
                            </div>
                          </section>
                        ))}
                    </div>
                  ) : (
                    <div className="panel">
                      <Empty
                        icon={<BookOpen size={32} />}
                        title="Your courses belong here"
                        description="Connect to UCA Moodle to list the courses visible in your overview. Nothing is synced until you ask."
                        action={
                          <button
                            className="button primary"
                            disabled={!!busy}
                            onClick={() =>
                              void perform("Syncing courses", api.syncCourses)
                            }
                          >
                            {busy ? (
                              <LoaderCircle size={16} className="spin" />
                            ) : (
                              <ArrowDownToLine size={16} />
                            )}
                            Sync Moodle courses
                          </button>
                        }
                      />
                    </div>
                  )}
                </>
              )}

              {page === "Study routines" && (
                <>
                  <div className="info-banner">
                    <Workflow size={19} />
                    <span>
                      Run a study reminder or a read-only Moodle coursework check.
                      Schedules run while the app is open or in the tray. Your instructions
                      are reminder text; they do not execute arbitrary browser actions.
                    </span>
                  </div>
                  {state.routines.length ? (
                    <div className="course-grid">
                      {state.routines.map((routine) => (
                        <section
                          className="panel routine-card"
                          key={routine.id}
                        >
                          <span className="kind-badge study">
                            {routine.action === "sync" ? "Moodle check" : "Study reminder"}
                          </span>
                          <h2>{routine.name}</h2>
                          <span className="course-caption">
                            {routine.course || "All my studies"}
                          </span>
                          <p className="routine-instructions">
                            {routine.instructions}
                          </p>
                          <label className="field">Schedule
                            <select aria-label={`Schedule ${routine.name}`} value={routine.cadence || "manual"} disabled={!!busy || isPreview}
                              onChange={event => void perform("Updating schedule", () => api.setRoutineSchedule(routine.id, event.target.value as Cadence))}>
                              <option value="manual">Manual only</option><option value="hourly">Every hour</option><option value="daily">Every day</option><option value="weekly">Every week</option>
                            </select>
                          </label>
                          {routine.nextRunAt && <p>Next check: {formatDate(routine.nextRunAt, true)}</p>}
                          {routine.lastRunAt && <p>Last run: {formatDate(routine.lastRunAt, true)}</p>}
                          {routine.lastError && <p className="form-error" role="status">{routine.lastError}</p>}
                          <button className="button secondary" disabled={!!busy || isPreview} onClick={() => void perform("Running routine", () => api.runRoutine(routine.id))}>Run now</button>
                          <button
                            disabled={!!busy}
                            className="text-button danger"
                            onClick={() =>
                              void perform("Removing routine", () =>
                                api.deleteRoutine(routine.id),
                              )
                            }
                          >
                            <Trash2 size={14} />
                            Remove routine
                          </button>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <div className="panel">
                      <Empty
                        icon={<Workflow size={32} />}
                        title="Good habits start with a small routine"
                        description="For example: check mathematics announcements for new homework, then collect the relevant lecture notes."
                        action={
                          <button
                            className="button primary"
                            onClick={() => setModal("routine")}
                          >
                            <Plus size={16} />
                            Save your first routine
                          </button>
                        }
                      />
                    </div>
                  )}
                </>
              )}

              {page === "Assistant" && (
                <AssistantPanel state={state} onUpdate={setState} openSettings={() => navigate("Settings")} />
              )}

              {page === "Settings" && (
                <div className="settings-stack">
                  <ConnectionSettings state={state} onUpdate={setState} />
                  <section className="panel settings-card">
                    <span className="section-icon">
                      <BookOpen size={22} />
                    </span>
                    <div>
                      <h2>Connect UCA Moodle</h2>
                      <p>
                        Run these commands in the project folder in your own
                        terminal. Your credentials are stored in Windows
                        Credential Manager.
                      </p>
                      <pre>
                        npm run lms:install{"\n"}npm run lms:browser{"\n"}npm
                        run credentials:set
                      </pre>
                      <p>
                        Then open Courses and choose Sync courses. The browser
                        opens visibly so you can finish recognized login or MFA
                        steps. SSO compatibility depends on the Moodle login
                        flow.
                      </p>
                      <button
                        className="button secondary"
                        onClick={() => navigate("Courses")}
                      >
                        Go to courses <ArrowRight size={16} />
                      </button>
                    </div>
                  </section>
                  <section className="panel settings-card">
                    <span className="section-icon">
                      <Settings2 size={22} />
                    </span>
                    <div>
                      <h2>Your local workspace</h2>
                      <p>
                        {isPreview
                          ? "This preview stores sample tasks in browser storage."
                          : "Tasks, course metadata, and routine instructions are stored in a SQLite database in your operating system’s application-data folder."}{" "}
                        Local study records are not encrypted by the app; your
                        operating-system account protects access.
                      </p>
                      <p>
                        Coursework imports include assignments and quizzes,
                        descriptions, source links, and explicit dates when readable.
                        You can edit uncertain or missing dates. Saved records remain
                        available offline.
                      </p>
                    </div>
                  </section>
                  <section className="panel settings-card">
                    <span className="section-icon">
                      <Sparkles size={22} />
                    </span>
                    <div>
                      <h2>Reminders and routine history</h2>
                      <p>
                        Deadline reminders and routine results are saved in your
                        inbox, even if system notifications are disabled. Enable
                        the system tray option above to keep schedules running
                        when the window is closed.
                      </p>
                      {!!state.notices.length && <button className="text-button" disabled={!!busy} onClick={() => void perform("Updating inbox", api.markNoticesRead)}>Mark all read</button>}
                      <div className="notice-list">{state.notices.slice().reverse().map(notice => <article className={notice.read ? "notice read" : "notice"} key={notice.id}><strong>{notice.title}</strong><p>{notice.body}</p><small>{formatDate(notice.createdAt, true)}</small></article>)}</div>
                      {!state.notices.length && <p>No reminders yet.</p>}
                    </div>
                  </section>
                </div>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>Made for a calmer kind of progress.</span>
            <span>
              Studyspace <span className="footer-dot">·</span> Early build 0.1
            </span>
          </footer>
        </main>
      </div>
      {modal && (
        <Modal
          title={
            modal === "task" ? (editing ? "Edit task" : "A new step forward") : "Save a study routine"
          }
          onClose={() => {
            if (!busy) {
              setModal(null);
              setEditing(null);
            }
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const value = (key: string) => String(data.get(key) || "").trim();
              if (modal === "task") {
                const due = value("dueAt");
                void perform("Saving task", () => {
                  const input = {
                    title: value("title"),
                    course: value("course"),
                    notes: value("notes"),
                    kind: value("kind") as TaskKind,
                    dueAt: due ? new Date(due).toISOString() : "",
                  };
                  return editing ? api.updateTask(editing.id, input) : api.addTask(input);
                }).then((ok) => {
                  if (ok) {
                    setModal(null);
                    setEditing(null);
                  }
                });
              } else {
                void perform("Saving routine", () =>
                  api.addRoutine({
                    name: value("name"),
                    course: value("course"),
                    instructions: value("instructions"),
                    action: value("action") as "reminder" | "sync",
                    courseId: value("courseId"),
                  }),
                ).then((ok) => {
                  if (ok) setModal(null);
                });
              }
            }}
          >
            {modal === "task" ? (
              <>
                <p className="modal-intro">
                  {editing?.source === "moodle"
                    ? "Changes stay in your workspace and are kept when you import again. Moodle is not updated."
                    : "Homework, an exam, or simply time to study. Make it yours."}
                </p>
                <label className="field">
                  What needs doing?
                  <input
                    name="title"
                    defaultValue={editing?.title || ""}
                    placeholder="e.g. Finish the calculus problem set"
                    required
                    maxLength={200}
                  />
                </label>
                <div className="form-columns">
                  <label className="field">
                    Type
                    <select
                      name="kind"
                      defaultValue={
                        editing?.kind || (page === "Exams & quizzes" ? "exam" : "homework")
                      }
                    >
                      {Object.entries(kindLabels).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Course <span>(optional)</span>
                    <input
                      name="course"
                      defaultValue={editing?.course || ""}
                      list="course-names"
                      placeholder="e.g. Calculus II"
                      maxLength={200}
                    />
                  </label>
                </div>
                <label className="field">
                  Deadline <span>(optional · your local time)</span>
                  <input name="dueAt" type="datetime-local" defaultValue={localDateTime(editing?.dueAt || "")} />
                </label>
                <label className="field">
                  Notes <span>(optional)</span>
                  <textarea
                    name="notes"
                    defaultValue={editing?.notes || ""}
                    rows={3}
                    placeholder="Anything you’ll want to remember…"
                    maxLength={4000}
                  />
                </label>
              </>
            ) : (
              <>
                <p className="modal-intro">
                  Choose a study reminder or a read-only coursework check.
                  Instructions are saved as reminder text. Set a recurring schedule after saving.
                </p>
                <label className="field">
                  Routine name
                  <input
                    name="name"
                    placeholder="e.g. Find this week’s mathematics homework"
                    required
                    maxLength={200}
                  />
                </label>
                <label className="field">
                  Course <span>(optional)</span>
                  <input
                    name="course"
                    list="course-names"
                    maxLength={200}
                    placeholder="e.g. Calculus II"
                  />
                </label>
                <label className="field">
                  Routine action
                  <select name="action" defaultValue="reminder"><option value="reminder">Study reminder</option><option value="sync">Import Moodle coursework</option></select>
                </label>
                <label className="field">
                  Moodle course (required for coursework checks)
                  <select name="courseId" defaultValue=""><option value="">Select a synced course</option>{state.courses.map(course => <option value={course.id} key={course.id}>{course.name}</option>)}</select>
                </label>
                <label className="field">
                  Where should the assistant look, and what should it collect?
                  <textarea
                    name="instructions"
                    rows={5}
                    required
                    maxLength={4000}
                    placeholder="Open the mathematics course, check announcements, and collect new homework instructions and explicit due dates…"
                  />
                </label>
              </>
            )}
            <datalist id="course-names">
              {state.courses.map((course) => (
                <option key={course.id} value={course.name} />
              ))}
            </datalist>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                disabled={!!busy}
                className="button secondary"
                onClick={() => {
                  setModal(null);
                  setEditing(null);
                }}
              >
                Cancel
              </button>
              <button className="button primary" disabled={!!busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Plus size={16} />
                )}
                {modal === "task" ? (editing ? "Save changes" : "Add task") : "Save routine"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {detail && (
        <Modal title="Task details" onClose={() => setDetail(null)}>
          <span className={`kind-badge ${detail.kind}`}>
            {kindLabels[detail.kind]}
          </span>
          <h2 className="detail-title">{detail.title}</h2>
          <p className="detail-course">{detail.course || "Personal study"}</p>
          <div className="detail-date">
            <CalendarDays size={18} />
            {formatDate(detail.dueAt, true)}
          </div>
          {detail.notes && <p className="detail-notes">{detail.notes}</p>}
          <div className="info-banner">
            {detail.source === "moodle"
              ? `Imported from Moodle${detail.checkedAt ? ` · checked ${formatDate(detail.checkedAt, true)}` : ""}. Completion and edits are tracked locally.`
              : "Added by you. This task is stored locally."}
          </div>
          {detail.opensAt && <p>Opens: {formatDate(detail.opensAt, true)}</p>}
          {detail.deadlineEvidence && <p className="detail-notes">Source date evidence: {detail.deadlineEvidence}{detail.deadlineTimeZone ? ` (${detail.deadlineTimeZone})` : ""}</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions spread">
            <button
              className="text-button danger"
              disabled={!!busy}
              onClick={() =>
                void perform("Removing task", () =>
                  api.deleteTask(detail.id),
                ).then((ok) => {
                  if (ok) setDetail(null);
                })
              }
            >
              <Trash2 size={15} />
              Remove
            </button>
            <div>
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() => {
                  setEditing(detail);
                  setDetail(null);
                  setError("");
                  setModal("task");
                }}
              >
                Edit task
              </button>
              {detail.sourceUrl && (
                <button
                  className="button secondary"
                  onClick={() => void openSource(detail.sourceUrl)}
                >
                  View source <ExternalLink size={15} />
                </button>
              )}
              <button
                className="button primary"
                disabled={!!busy}
                onClick={() =>
                  void perform("Saving task", () =>
                    api.toggleTask(detail.id),
                  ).then((ok) => {
                    if (ok) setDetail(null);
                  })
                }
              >
                <Check size={16} />
                {detail.completed ? "Reopen task" : "Mark complete"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  sub: string;
  color: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <span className={`stat-icon ${color}`}>{icon}</span>
      </div>
      <strong className="stat-value">
        {value.toString().padStart(2, "0")}
      </strong>
      <span className="stat-sub">{sub}</span>
    </div>
  );
}
function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
