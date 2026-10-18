// Runs outside the renderer and main process. Credentials never enter UI messages.
process.parentPort.once("message", async ({ data }) => {
  try {
    let result;
    if (data.operation === "courses") {
      const { listCourses } = await import(
        "../lms-agent/src/browser/courses.js"
      );
      result = await listCourses();
    } else if (data.operation === "assignments") {
      const { listAssignments } = await import(
        "../lms-agent/src/browser/assignments.js"
      );
      result = await listAssignments(data.courseId);
    } else throw new Error("Unsupported Moodle operation.");
    process.parentPort.postMessage({ ok: true, result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Moodle operation failed.";
    // Playwright exception details can include DOM excerpts and call logs. Return a category only.
    const safe = message.includes("No LMS credentials")
      ? "No credentials found. Run npm run credentials:set in your terminal."
      : /Executable doesn't exist|Cannot find package|Cannot find module/.test(
            message,
          )
        ? "Moodle dependencies or Chromium are missing. Complete the setup commands in Settings."
        : /login|credential|MFA|SSO/i.test(message)
          ? "Moodle login did not complete. Check stored credentials and finish any browser login steps."
          : "Moodle could not be read. Check your connection and try again. Your saved data is unchanged.";
    process.parentPort.postMessage({ ok: false, error: safe });
  }
});
