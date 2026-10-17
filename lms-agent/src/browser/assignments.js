import { config } from '../config.js';
import { cleanText, sanitizeUrl } from '../security/sanitize.js';
import { withAuthenticatedPage } from './session.js';

const ASSIGNMENT_LINK = 'a[href*="/mod/assign/view.php?id="]';

export async function listAssignments(courseId) {
  if (!/^\d+$/.test(String(courseId))) throw new Error('Course ID must be numeric.');
  const courseUrl = new URL('/course/view.php', config.baseUrl);
  courseUrl.searchParams.set('id', String(courseId));

  return withAuthenticatedPage(courseUrl.toString(), async (page) => {
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.locator(ASSIGNMENT_LINK).first()
      .waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {});

    const courseName = cleanText(await page.locator('h1').first().innerText().catch(() => ''));
    const raw = await page.locator(ASSIGNMENT_LINK).evaluateAll((links) => links.map((link) => {
      const section = link.closest('[data-for="section"], .course-section, li.section');
      const sectionName = section?.querySelector(
        '[data-for="section_title"], .sectionname, .section-title',
      )?.innerText;
      return { title: link.innerText, href: link.href, section: sectionName };
    }));

    return {
      course: { id: String(courseId), name: courseName, url: courseUrl.toString() },
      assignments: normalizeAssignments(raw),
    };
  });
}

export function normalizeAssignments(items) {
  const assignments = new Map();
  for (const item of items || []) {
    const href = sanitizeUrl(item.href, config.baseUrl);
    if (!href) continue;
    const url = new URL(href);
    if (url.origin !== new URL(config.baseUrl).origin || url.pathname !== '/mod/assign/view.php') continue;
    const id = url.searchParams.get('id');
    if (!/^\d+$/.test(id || '')) continue;
    const title = cleanActivityName(item.title);
    assignments.set(id, {
      id,
      title: title || `Assignment ${id}`,
      section: cleanText(item.section),
      url: href,
    });
  }
  return [...assignments.values()];
}

function cleanActivityName(value) {
  return cleanText(value)
    .replace(/\s*Assignment\s*$/i, '')
    .replace(/^Assignment\s*/i, '')
    .trim();
}
