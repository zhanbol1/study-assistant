// Optional read-only account check: extracts one PPTX; prints counts only.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "../desktop/store.mjs";
import { createMoodleTools } from "../desktop/moodle-tools.mjs";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, "lms-agent/.playwright-browsers");
process.env.LMS_DATA_DIR = path.join(root, ".runtime/slides-live");
process.env.LMS_HEADLESS = "true";
const { listCourses } = await import("../lms-agent/src/browser/courses.js");
const { listCourseFiles } = await import("../lms-agent/src/browser/files.js");
const { readCourseSlides } = await import("../lms-agent/src/browser/presentation.js");
const { withAuthenticatedPage } = await import("../lms-agent/src/browser/session.js");
const { safeMoodleError } = await import("../lms-agent/src/browser/errors.js");
const inspect = process.argv.includes("--inspect-first-folder");
const courseArg = process.argv.indexOf("--course");
const requestedCourse = courseArg >= 0 ? process.argv[courseArg + 1]?.toLowerCase() : null;
const store = createStore(":memory:");
const sources = [];
const execute = createMoodleTools({ store, sources, read: async (operation, args) => { try {
  if (operation === "courses") return await listCourses();
  if (operation === "files") return await listCourseFiles(args.courseId, args.activityId);
  if (operation === "read-slides") return await readCourseSlides(args.courseId, args.activityId, args.fileId);
  throw new Error("Unsupported live-check operation.");
} catch (error) { const failure = safeMoodleError(error); throw Object.assign(new Error(failure.message), { code: failure.code, retryable: failure.retryable }); } } });
async function call(name, args = {}) {
  const result = await execute({ name, arguments: JSON.stringify(args) });
  if (result.error) throw new Error(result.error);
  return result;
}
try {
  const { courses } = await call("list_courses");
  console.log(JSON.stringify({ visibleCourses: courses.length }));
  if (!courses.length) throw new Error("No Moodle courses are visible. Check login and the course-overview filters before repeating this live check.");
  // Prefer recent course cards; inspect at most eight courses and six folders.
  const selected = requestedCourse ? courses.filter(course => course.name.toLowerCase().includes(requestedCourse)) : [...courses.slice(4), ...courses.slice(0, 4)].slice(0, 8);
  if (!selected.length) throw new Error("The requested course is not in the visible course overview.");
  let folders = 0, found = false;
  for (const [index, course] of selected.entries()) {
    console.log(JSON.stringify({ checkingCourse: index + 1 }));
    const listing = await call("list_files", { course_id: course.id, activity_id: null });
    const ordered = listing.files.filter(file => file.type === "folder").sort((a, b) => Number(/lecture|slide|presentation/i.test(b.title)) - Number(/lecture|slide|presentation/i.test(a.title)));
    for (const folder of ordered) {
      if (folders++ >= 6) break;
      console.log(JSON.stringify({ checkingFolder: folders }));
      if (inspect) {
        await withAuthenticatedPage(folder.sourceUrl, async page => {
          await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
          const structure = await page.evaluate(() => {
            const all = [...document.querySelectorAll('a[href]')].filter(link => link.href.includes('/pluginfile.php'));
            const extensions = {};
            for (const link of all) {
              const url = new URL(link.href);
              const extension = (url.searchParams.get('file') || url.pathname).match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() || 'other';
              extensions[extension] = (extensions[extension] || 0) + 1;
            }
            return { pluginFileLinks: all.length, linksInMain: document.querySelectorAll('#region-main a[href*="/pluginfile.php"]').length, queryFileLinks: all.filter(link => new URL(link.href).pathname === '/pluginfile.php').length, folderTreeNodes: document.querySelectorAll('.foldertree, [role="tree"], .ygtvitem').length, extensions };
          });
          console.log(JSON.stringify(structure));
        });
        found = true; break;
      }
      const inside = await call("list_files", { course_id: course.id, activity_id: folder.activity_id });
      console.log(JSON.stringify({ folderFiles: inside.files.length - 1, pptxFiles: inside.files.filter(file => /\.pptx$/i.test(file.filename || file.title)).length }));
      const pptx = inside.files.find(file => /\.pptx$/i.test(file.filename || file.title));
      if (!pptx) continue;
      console.log("Reading one PPTX from the discovered folder.");
      const result = await call("read_slides", { course_id: course.id, file_id: pptx.file_id, start_slide: 1, max_slides: 20 });
      const characters = result.slides.reduce((sum, slide) => sum + slide.text.length + slide.notes.length, 0);
      console.log(JSON.stringify({ folderFiles: inside.files.length - 1, totalSlides: result.total_slides, slidesReturned: result.slides.length, textCharacters: characters, slideSources: sources.length, nextSlide: result.next_slide, downloadedFiles: store.snapshot().downloads.length }));
      if (!characters) throw new Error("The selected presentation has no extractable text in this range. Images need visual reading.");
      found = true; break;
    }
    if (found || folders >= 6) break;
  }
  if (!found) throw new Error("No PPTX found within the checked courses/folders.");
  console.log(inspect ? "Folder-link inspection complete. No filenames or contents were printed." : "Live Moodle folder/PPTX reading passed. No slide content was printed or sent to AI.");
} finally { store.close(); }
