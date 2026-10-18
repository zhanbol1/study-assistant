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
  };
}
