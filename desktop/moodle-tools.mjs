import { moodleUrl, numericId } from "./validation.mjs";

const object = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export const moodleFunctions = [
  { type: "function", name: "list_courses", description: "Read the student's current Moodle course list. Call first before requesting coursework. No arguments.", strict: true, parameters: object({}) },
  { type: "function", name: "get_coursework", description: "Read current homework, quizzes and exams, descriptions and explicit deadlines for a course returned by list_courses. Read each relevant course for a question covering all courses. Unknown deadlines stay unknown. Does not determine whether work has been submitted or completed.", strict: true, parameters: object({ course_id: { type: "string" }, kind: { type: "string", enum: ["all", "homework", "quiz", "exam"] } }) },
];

// A fresh capability scope for each user message. Only discovered course IDs
// can be read; neither the model nor page content can supply arbitrary URLs.
export function createMoodleTools({ read, store, sources, progress = () => {}, signal }) {
  let courses;
  const coursework = new Map();
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
          const data = { title: item.title, kind: item.kind, description: item.description?.slice(0, 2000) || "", dueAt: item.dueAt || null, opensAt: item.opensAt || null, deadlineEvidence: item.deadlineEvidence || "No explicit deadline found.", detailsRead: item.detailsRead === true, sourceUrl, checkedAt };
          const reference = `M${sources.filter(source => source.reference.startsWith("M")).length + 1}`;
          sources.push({ id: `${course.id}:${item.id}`, reference, title: `${course.name}: ${item.title}`, sourceUrl, content: JSON.stringify(data) });
          return { ...data, reference };
        });
        // Include a source even when no assignments are visible.
        const reference = `M${sources.filter(source => source.reference.startsWith("M")).length + 1}`;
        sources.push({ id: `course:${course.id}`, reference, title: course.name, sourceUrl: moodleUrl(course.url), content: `Checked ${checkedAt}. ${items.length} visible homework, quiz or exam activities. Hidden activities and submission status are not available.` });
        coursework.set(course.id, { course: course.name, checkedAt, reference, items });
      }
      const result = coursework.get(course.id);
      return { ...result, items: result.items.filter(item => args.kind === "all" || item.kind === args.kind), limitations: "Visible activities only. Missing deadlines are unknown. Submission/completion status is not checked. Past activities may remain visible; compare dates to today. Never describe these as outstanding unless verified." };
    } catch (error) {
      signal?.throwIfAborted();
      return { error: error.message, instruction: "Report this limitation. Do not invent coursework or treat an unread course as empty." };
    }
  };
}
