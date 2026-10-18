import { config } from '../config.js';
import { cleanText, sanitizeUrl } from '../security/sanitize.js';
import { withAuthenticatedPage } from './session.js';

const ACTIVITY_LINK = [
  '#region-main a[href*="/mod/"][href*="/view.php?id="]',
  '[data-region="course-content"] a[href*="/mod/"][href*="/view.php?id="]',
  '.course-content a[href*="/mod/"][href*="/view.php?id="]',
].join(', ');

export async function listActivities(courseId) {
  validateNumeric(courseId, 'Course ID');
  const courseUrl = courseUrlFor(courseId);
  return withAuthenticatedPage(courseUrl, async (page) => {
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.locator(ACTIVITY_LINK).first()
      .waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {});
    const raw = await extractActivities(page);
    return { courseId: String(courseId), activities: normalizeActivities(raw) };
  });
}

export async function downloadActivity(courseId, activityId) {
  const { downloadCourseFile } = await import('./files.js');
  return downloadCourseFile(courseId, activityId, 'activity:' + activityId);
}

async function extractActivities(page) {
  return page.locator(ACTIVITY_LINK).evaluateAll((links) => links.map((link) => {
    const activity = link.closest('.activity, [data-for="cmitem"], li[id^="module-"]');
    const section = link.closest('[data-for="section"], .course-section, li.section');
    return {
      title: activity?.querySelector('.activityname, .instancename')?.innerText || link.innerText,
      href: link.href,
      section: section?.querySelector('[data-for="section_title"], .sectionname, .section-title')?.innerText,
    };
  }));
}

export function normalizeActivities(items) {
  const activities = new Map();
  for (const item of items || []) {
    const href = sanitizeUrl(item.href, config.baseUrl);
    if (!href) continue;
    const url = new URL(href);
    if (url.origin !== new URL(config.baseUrl).origin) continue;
    const match = url.pathname.match(/^\/mod\/([a-z0-9_]+)\/view\.php$/i);
    const id = url.searchParams.get('id');
    if (!match || !/^\d+$/.test(id || '')) continue;
    const key = `${match[1]}:${id}`;
    if (!activities.has(key)) {
      activities.set(key, {
        id,
        type: match[1].toLowerCase(),
        title: cleanActivityTitle(item.title, match[1]),
        section: cleanText(item.section),
        url: href,
      });
    }
  }
  return [...activities.values()];
}

function cleanActivityTitle(value, type) {
  return cleanText(value)
    .replace(new RegExp(`\\s*${type}\\s*$`, 'i'), '')
    .replace(/\s*(File|Assignment|Page|URL|Folder|Quiz)\s*$/i, '')
    .trim();
}

function validateNumeric(value, label) {
  if (!/^\d+$/.test(String(value))) throw new Error(`${label} must be numeric.`);
}

function courseUrlFor(courseId) {
  const url = new URL('/course/view.php', config.baseUrl);
  url.searchParams.set('id', String(courseId));
  return url.toString();
}
