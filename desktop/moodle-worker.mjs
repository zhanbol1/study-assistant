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
      const { listCoursework } = await import(
        "../lms-agent/src/browser/coursework.js"
      );
      result = await listCoursework(data.courseId, data.timeZone);
    } else if (data.operation === "files" || data.operation === "download") {
      const { listCourseFiles, downloadCourseFile } = await import("../lms-agent/src/browser/files.js");
      result = data.operation === "files" ? await listCourseFiles(data.courseId.courseId, data.courseId.activityId)
        : await downloadCourseFile(data.courseId.courseId, data.courseId.activityId, data.courseId.fileId);
    } else if (data.operation === "read-slides") {
      const { readCourseSlides } = await import("../lms-agent/src/browser/presentation.js");
      result = await readCourseSlides(data.courseId.courseId, data.courseId.activityId, data.courseId.fileId);
    } else throw new Error("Unsupported Moodle operation.");
    process.parentPort.postMessage({ ok: true, result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Moodle operation failed.";
    // Playwright exception details can include DOM excerpts and call logs. Return a category only.
    const safe = error?.name === "PresentationReadError" ? message : message.includes("No LMS credentials")
      ? "No credentials found. Run npm run credentials:set in your terminal."
      : /Executable doesn't exist|Cannot find package|Cannot find module/.test(
            message,
          )
        ? "Moodle dependencies or Chromium are missing. Run npm run lms:install and npm run lms:browser in your project terminal."
        : /login|credential|MFA|SSO/i.test(message)
          ? "Moodle login did not complete. Update stored credentials using npm run credentials:set. SSO or MFA may require interactive login."
          : "Moodle could not be read. Check your connection and try again. Your saved data is unchanged.";
    process.parentPort.postMessage({ ok: false, error: safe });
  }
});
