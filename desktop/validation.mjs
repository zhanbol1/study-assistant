export function text(value, label, max = 300, optional = false) {
  if (optional && (value === undefined || value === null || value === ""))
    return "";
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${label} must contain 1–${max} characters.`);
  }
  return value.trim();
}

export function numericId(value) {
  if (typeof value !== "string" || !/^\d{1,15}$/.test(value))
    throw new Error("Invalid Moodle ID.");
  return value;
}

export function moodleUrl(value) {
  const url = new URL(value);
  if (url.origin !== "https://ucasaslms.org" || url.username || url.password) {
    throw new Error("Only links to the configured Moodle site are supported.");
  }
  if (
    ![
      "/course/view.php",
      "/mod/assign/view.php",
      "/mod/quiz/view.php",
      "/mod/resource/view.php",
      "/mod/folder/view.php",
    ].includes(url.pathname) ||
    !/^\d+$/.test(url.searchParams.get("id") || "")
  )
    throw new Error("Invalid Moodle link.");
  // Reconstruct the URL so neither fragments nor arbitrary query parameters leave the app.
  return `${url.origin}${url.pathname}?id=${url.searchParams.get("id")}`;
}

export function taskInput(value) {
  if (!value || !["homework", "exam", "quiz", "study"].includes(value.kind))
    throw new Error("Choose a task type.");
  const title = text(value.title, "Title", 200);
  const course = text(value.course, "Course", 200, true);
  const notes = text(value.notes, "Notes", 4000, true);
  const dueAt = value.dueAt || "";
  if (
    typeof dueAt !== "string" ||
    (dueAt &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dueAt) ||
        !Number.isFinite(Date.parse(dueAt))))
  ) {
    throw new Error("Choose a valid deadline.");
  }
  return {
    title,
    course,
    notes,
    dueAt: dueAt ? new Date(dueAt).toISOString() : "",
    kind: value.kind,
  };
}

export function routineInput(value) {
  if (!value) throw new Error("Enter a routine.");
  return {
    name: text(value.name, "Name", 200),
    course: text(value.course, "Course", 200, true),
    instructions: text(value.instructions, "Instructions", 4000),
    action: value.action === undefined ? "reminder" : routineAction(value.action),
    courseId: value.courseId ? numericId(value.courseId) : "",
  };
}

function routineAction(value) {
  if (!["reminder", "sync"].includes(value)) throw new Error("Choose a supported routine action.");
  return value;
}

export const defaultSettings = () => ({
  model: "gpt-4.1-mini", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  remindersEnabled: false, reminderMinutes: 60, backgroundEnabled: false,
});

export function settingsInput(input, previous = defaultSettings()) {
  if (!input || typeof input !== "object") throw new Error("Invalid settings.");
  const result = { ...previous };
  for (const key of ["remindersEnabled", "backgroundEnabled"]) {
    if (key in input) {
      if (typeof input[key] !== "boolean") throw new Error("Invalid setting.");
      result[key] = input[key];
    }
  }
  if ("reminderMinutes" in input) {
    if (!Number.isInteger(input.reminderMinutes) || input.reminderMinutes < 1 || input.reminderMinutes > 10080) throw new Error("Reminder lead time must be 1–10080 minutes.");
    result.reminderMinutes = input.reminderMinutes;
  }
  if ("model" in input) {
    result.model = text(input.model, "Model", 100);
    if (!/^[a-zA-Z0-9._:-]+$/.test(result.model)) throw new Error("Invalid model ID.");
  }
  if ("timeZone" in input) {
    result.timeZone = text(input.timeZone, "Time zone", 100);
    try { new Intl.DateTimeFormat("en", { timeZone: result.timeZone }); }
    catch { throw new Error("Enter a valid IANA time zone, such as Asia/Bishkek."); }
  }
  return result;
}

export function optionalDate(value) {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d.*(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Invalid source date.");
  return new Date(value).toISOString();
}
