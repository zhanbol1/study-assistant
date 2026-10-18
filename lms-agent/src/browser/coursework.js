import { config } from '../config.js';
import { cleanText } from '../security/sanitize.js';
import { withAuthenticatedPage } from './session.js';
import { normalizeActivities } from './activities.js';
import { deadlineDetails, extractDetailDom } from './deadlines.js';

export async function listCoursework(courseId, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (!/^\d{1,15}$/.test(String(courseId))) throw new Error('Course ID must be numeric.');
  new Intl.DateTimeFormat('en', { timeZone });
  const url = new URL(`/course/view.php?id=${courseId}`, config.baseUrl);
  return withAuthenticatedPage(url.toString(), async page => {
    const destination = new URL(page.url());
    if (destination.origin !== url.origin || destination.pathname !== url.pathname || destination.searchParams.get('id') !== String(courseId)) throw new Error('Moodle did not open the requested course.');
    await page.locator('#region-main').waitFor();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const raw = await page.locator('#region-main a[href*="/mod/"], .course-content a[href*="/mod/"]').evaluateAll(links => links.map(link => ({
      href: link.href, title: link.innerText,
      section: link.closest('.section, .course-section, [data-for="section"]')?.querySelector('.sectionname, [data-for="section_title"]')?.textContent,
    })));
    const activities = normalizeActivities(raw).filter(item => ['assign', 'quiz'].includes(item.type));
    if (activities.length > 200) throw new Error('Too many coursework items to read in one course.');
    const assignments = [];
    for (const item of activities) {
      const record = { ...item, kind: item.type === 'quiz' ? (/\b(exam|midterm|final)\b/i.test(item.title) ? 'exam' : 'quiz') : 'homework' };
      try {
        await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const finalUrl = new URL(page.url());
        if (finalUrl.origin !== url.origin || finalUrl.pathname !== `/mod/${item.type}/view.php`) throw new Error('Unexpected destination.');
        const detail = await page.evaluate(extractDetailDom);
        if (detail.login || !detail.content) throw new Error('Coursework content unavailable.');
        Object.assign(record, deadlineDetails(detail.entries, timeZone), { description: cleanText(detail.description).slice(0, 4000), detailsRead: true });
      } catch {
        record.detailsRead = false;
        record.deadlineEvidence = 'Details could not be read. Check the source in Moodle.';
      }
      assignments.push(record);
    }
    return { courseId: String(courseId), assignments, activityCount: normalizeActivities(raw).length };
  });
}
