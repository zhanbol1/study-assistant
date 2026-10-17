import { config } from '../config.js';
import { cleanText, sanitizeUrl } from '../security/sanitize.js';
import { waitForMoodleContent, withAuthenticatedPage } from './session.js';

const COURSE_LINK_SELECTOR = [
  '[data-region="course-content"] a[href*="/course/view.php?id="]',
  '[data-region="course-overview"] a[href*="/course/view.php?id="]',
  '.block_myoverview a[href*="/course/view.php?id="]',
].join(', ');

const COURSE_CARD_SELECTOR = [
  '[data-region="course-content"] [data-course-id]',
  '[data-region="course-content"] .dashboard-card',
  '[data-region="course-overview"] [data-course-id]',
  '.block_myoverview [data-course-id]',
  '.block_myoverview .dashboard-card',
].join(', ');

export async function listCourses() {
  return withAuthenticatedPage(config.coursesUrl, async (page) => {
    await waitForMoodleContent(page);
    let links = await page.locator(COURSE_LINK_SELECTOR).evaluateAll((elements) =>
      elements.map((element) => ({
        text: element.innerText || element.getAttribute('aria-label') || element.title,
        href: element.href,
      })),
    );
    if (links.length === 0) {
      links = await page.locator(COURSE_CARD_SELECTOR).evaluateAll((cards) =>
        cards.map((card) => {
          const anchor = card.querySelector('a[href*="/course/view.php?id="]');
          return {
            text: card.querySelector('[data-region="course-name"], .coursename .multiline, .coursename')?.innerText
              || anchor?.innerText,
            href: anchor?.href,
          };
        }),
      );
    }
    return normalizeCourses(links);
  });
}

export function normalizeCourses(links) {
  const courses = new Map();
  for (const link of links || []) {
    const href = sanitizeUrl(link.href, config.baseUrl);
    if (!href) continue;
    const url = new URL(href);
    if (url.origin !== new URL(config.baseUrl).origin) continue;
    if (url.pathname !== '/course/view.php') continue;
    const id = url.searchParams.get('id');
    if (!/^\d+$/.test(id || '')) continue;

    const name = cleanCourseName(link.text);
    const previous = courses.get(id);
    if (!previous || name.length > previous.name.length) {
      courses.set(id, { id, name: name || `Course ${id}`, url: href });
    }
  }
  return [...courses.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function cleanCourseName(value) {
  let name = cleanText(value)
    .replace(/^Course is starred\s+/i, '')
    .replace(/^Course name\s+/i, '')
    .trim();
  const words = name.split(' ');
  if (words.length % 2 === 0) {
    const middle = words.length / 2;
    if (words.slice(0, middle).join(' ') === words.slice(middle).join(' ')) {
      name = words.slice(0, middle).join(' ');
    }
  }
  return name;
}
