import { safeMoodleError } from "../lms-agent/src/browser/errors.js";
// Runs outside the renderer and main process. Credentials never enter UI messages.
let busy = false;
let stopping = false;
process.parentPort.on("message", async ({ data }) => {
  if (data.operation === "shutdown") {
    stopping = true;
    const { closeMoodleSession } = await import("../lms-agent/src/browser/session.js");
    await closeMoodleSession();
    process.exit(0);
  }
  if (busy || stopping) return;
  busy = true;
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
    process.parentPort.postMessage({ id: data.id, ok: true, result });
  } catch (error) {
    const failure = safeMoodleError(error);
    process.parentPort.postMessage({ id: data.id, ok: false, error: failure.message, errorCode: failure.code, retryable: failure.retryable });
  } finally {
    busy = false;
  }
});
