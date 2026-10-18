import { moodleUrl, numericId } from "./validation.mjs";

const object = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export const moodleFunctions = [
  { type: "function", name: "list_courses", description: "Read the student's current Moodle course list. Call first before requesting coursework. No arguments.", strict: true, parameters: object({}) },
  { type: "function", name: "get_coursework", description: "Read current homework, quizzes and exams, descriptions and explicit deadlines for a course returned by list_courses. Read each relevant course for a question covering all courses. Unknown deadlines stay unknown. Returns explicit submission or quiz-attempt state when available; missing evidence stays unknown.", strict: true, parameters: object({ course_id: { type: "string" }, kind: { type: "string", enum: ["all", "homework", "quiz", "exam"] } }) },
  { type: "function", name: "list_files", description: "Find downloadable Moodle resources. Use null activity_id for course files/folder ZIPs, or an activity ID from get_coursework to list its homework/quiz attachments. Call list_courses first. File contents are not read by this tool.", strict: true, parameters: object({ course_id: { type: "string" }, activity_id: { type: ["string", "null"] } }) },
  { type: "function", name: "download_file", description: "Download a file listed by list_files in this turn to the user's local Downloads collection. Use only when the user requests a download. Does not read PDF/Word content or submit work. Pass the exact returned file_id.", strict: true, parameters: object({ course_id: { type: "string" }, file_id: { type: "string" } }) },
];

// A fresh capability scope for each user message. Only discovered course IDs
// can be read; neither the model nor page content can supply arbitrary URLs.
export function createMoodleTools({ read, store, sources, progress = () => {}, signal, onChange = () => {} }) {
  let courses;
  const coursework = new Map();
  const files = new Map();
  const downloads = new Map();
  return async call => {
    signal?.throwIfAborted();
    try {
      if (call.namespace && call.namespace !== "moodle") throw new Error("Unknown tool namespace.");
      const name = call.name?.replace(/^moodle\./, "");
      const args = JSON.parse(call.arguments);
      if (!args || Array.isArray(args) || typeof args !== "object") throw new Error("Tool arguments must be an object.");
      if (name === "list_courses") {
        if (Object.keys(args).length) throw new Error("list_courses takes no arguments.");
        if (!courses) {
          progress("Checking your Moodle courses");
          const result = await read("courses", undefined, true, signal);
          signal?.throwIfAborted();
          store.cacheCourses(result);
          courses = store.snapshot().courses;
        }
        return { checkedAt: new Date().toISOString(), courses: courses.map(({ id, name }) => ({ id, name })), instruction: "Read all relevant courses before claiming a complete overview. Course membership alone does not establish current coursework." };
      }
      if (["list_files", "download_file"].includes(name)) {
        const keys = Object.keys(args).sort().join(",");
        if (typeof args.course_id !== "string") throw new Error("Provide a discovered course ID.");
        const course = courses?.find(course => course.id === args.course_id);
        if (!course) throw new Error("Call list_courses first and use a course ID from that result.");
        if (name === "list_files") {
          if (keys !== "activity_id,course_id" || (args.activity_id !== null && typeof args.activity_id !== "string")) throw new Error("Provide course_id and activity_id (or null).");
          if (args.activity_id !== null) numericId(args.activity_id);
          progress(`Finding files in ${course.name}`);
          const result = await read("files", { courseId: course.id, activityId: args.activity_id }, true, signal);
          signal?.throwIfAborted();
          if (!Array.isArray(result.files) || result.files.length > 500) throw new Error("Invalid file list.");
          const available = result.files.map(file => {
            numericId(file.activityId);
            if (typeof file.id !== "string" || file.id.length > 100) throw new Error("Invalid file ID.");
            files.set(`${course.id}:${file.id}`, file);
            return { file_id: file.id, activity_id: file.activityId, title: file.title, type: file.type, sourceUrl: moodleUrl(file.sourceUrl) };
          });
          return { course: course.name, files: available, checkedAt: new Date().toISOString() };
        }
        if (keys !== "course_id,file_id" || typeof args.file_id !== "string") throw new Error("Provide course_id and file_id.");
        const key = `${course.id}:${args.file_id}`;
        const file = files.get(key);
        if (!file) throw new Error("Call list_files first and use a file ID from that result.");
        if (downloads.has(key)) return downloads.get(key);
        if (downloads.size >= 10) throw new Error("Download limit reached (10 files per message). Ask to continue.");
        progress(`Downloading ${file.title}`);
        const result = await read("download", { courseId: course.id, activityId: file.activityId, fileId: file.id }, true, signal);
        signal?.throwIfAborted();
        const saved = store.addDownload({ ...result.file, course: course.name, sourceUrl: file.sourceUrl });
        const output = { downloaded: true, ...saved, location: "Downloads in the left sidebar", contentsRead: false };
        downloads.set(key, output);
        onChange();
        return output;
      }
      if (name !== "get_coursework") throw new Error("Unknown Moodle tool.");
      if (Object.keys(args).sort().join(",") !== "course_id,kind" || typeof args.course_id !== "string" || !["all", "homework", "quiz", "exam"].includes(args.kind)) throw new Error("Provide course_id and a valid kind.");
      numericId(args.course_id);
      const course = courses?.find(course => course.id === args.course_id);
      if (!course) throw new Error("Call list_courses first and use a course ID from that result.");
      if (!coursework.has(course.id)) {
        if (coursework.size >= 20) throw new Error("Course limit reached. Explain which courses remain unchecked and ask to continue.");
        progress(`Reading ${course.name}`);
        const result = await read("assignments", course.id, true, signal);
        signal?.throwIfAborted();
        store.cacheAssignments(course.id, result);
        const checkedAt = new Date().toISOString();
        const items = result.assignments.map(item => {
          const sourceUrl = moodleUrl(item.url);
          const data = { activityId: item.id, title: item.title, kind: item.kind, description: item.description?.slice(0, 2000) || "", dueAt: item.dueAt || null, opensAt: item.opensAt || null, deadlineEvidence: item.deadlineEvidence || "No explicit deadline found.", submissionStatus: item.submissionStatus || "unknown", completionEvidence: item.completionEvidence || "Not checked or unavailable.", detailsRead: item.detailsRead === true, sourceUrl, checkedAt };
          const reference = `M${sources.filter(source => source.reference.startsWith("M")).length + 1}`;
          sources.push({ id: `${course.id}:${item.id}`, reference, title: `${course.name}: ${item.title}`, sourceUrl, content: JSON.stringify(data) });
          return { ...data, reference };
        });
        // Include a source even when no assignments are visible.
        const reference = `M${sources.filter(source => source.reference.startsWith("M")).length + 1}`;
        sources.push({ id: `course:${course.id}`, reference, title: course.name, sourceUrl: moodleUrl(course.url), content: `Checked ${checkedAt}. ${items.length} visible homework, quiz or exam activities. Hidden activities and missing completion evidence are not available.` });
        coursework.set(course.id, { course: course.name, checkedAt, reference, items });
      }
      const result = coursework.get(course.id);
      return { ...result, items: result.items.filter(item => args.kind === "all" || item.kind === args.kind), limitations: "Visible activities only. Missing deadlines and missing completion evidence are unknown. A past deadline does not mean work is complete. A finished quiz attempt does not establish a final grade. Compare explicit dates to today and apply the user's Memory rules without inventing evidence." };
    } catch (error) {
      signal?.throwIfAborted();
      return { error: error.message, instruction: "Report this limitation. Do not invent coursework or treat an unread course as empty." };
    }
  };
}
