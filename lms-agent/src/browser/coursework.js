import { config } from '../config.js';
import { cleanText } from '../security/sanitize.js';
import { withAuthenticatedPage } from './session.js';
import { normalizeActivities } from './activities.js';
import { deadlineDetails, extractDetailDom } from './deadlines.js';
import { completionDetails } from './completion.js';
import { openMoodlePage } from './navigation.js';
import { MoodleError } from './errors.js';

export async function listCoursework(courseId, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (!/^\d{1,15}$/.test(String(courseId))) throw new Error('Course ID must be numeric.');
  new Intl.DateTimeFormat('en', { timeZone });
  const url = new URL(`/course/view.php?id=${courseId}`, config.baseUrl);
  return withAuthenticatedPage(url.toString(), async page => {
    const destination = new URL(page.url());
    if (destination.origin !== url.origin || destination.pathname !== url.pathname || destination.searchParams.get('id') !== String(courseId)) throw new MoodleError('course-unavailable');
    await page.locator('#region-main').waitFor();
    await page.locator('.course-content').first().waitFor({ state: 'attached', timeout: 20000 });
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
        await openMoodlePage(page, item.url, { timeout: 20000 });
        await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
        const finalUrl = new URL(page.url());
        if (finalUrl.origin !== url.origin || finalUrl.pathname !== `/mod/${item.type}/view.php` || finalUrl.searchParams.get('id') !== item.id) throw new Error('Unexpected destination.');
        const detail = await page.evaluate(extractDetailDom);
        if (detail.login || !detail.content) throw new Error('Coursework content unavailable.');
        Object.assign(record, deadlineDetails(detail.entries, timeZone), completionDetails(detail.entries, detail.attemptStates), { description: cleanText(detail.description).slice(0, 4000), detailsRead: true });
      } catch {
        record.detailsRead = false;
        record.deadlineEvidence = 'Details could not be read. Check the source in Moodle.';
      }
      assignments.push(record);
    }
    return { courseId: String(courseId), assignments, activityCount: normalizeActivities(raw).length };
  });
}
