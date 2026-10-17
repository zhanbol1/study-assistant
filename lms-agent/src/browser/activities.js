import fs from 'node:fs/promises';
import path from 'node:path';
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
  validateNumeric(courseId, 'Course ID');
  validateNumeric(activityId, 'Activity ID');
  const courseUrl = courseUrlFor(courseId);

  return withAuthenticatedPage(courseUrl, async (page, context) => {
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    const activities = normalizeActivities(await extractActivities(page));
    const activity = activities.find((item) => item.id === String(activityId));
    if (!activity) throw new Error('Activity was not found inside the selected course.');
    if (!['resource', 'folder'].includes(activity.type)) {
      throw new Error(`Activity type '${activity.type}' is not a downloadable course resource.`);
    }

    const requestUrl = activity.type === 'folder'
      ? folderDownloadUrl(activity.id)
      : activity.url;
    const response = await context.request.get(requestUrl, { timeout: 60_000 });
    if (!response.ok()) throw new Error(`Resource download failed with HTTP ${response.status()}.`);
    const body = await response.body();
    if (body.byteLength > 100 * 1024 * 1024) throw new Error('Resource exceeds the 100 MB safety limit.');

    const headers = response.headers();
    const sourceFilename =
      filenameFromDisposition(headers['content-disposition'])
        || filenameFromUrl(response.url())
        || `${activity.type}-${activity.id}${activity.type === 'folder' ? '.zip' : ''}`;
    const filename = safeFilename(`${activity.id}-${sourceFilename}`);
    const outputPath = path.join(config.downloadsDir, filename);
    await fs.writeFile(outputPath, body);
    return {
      activity,
      file: { path: outputPath, filename, bytes: body.byteLength, contentType: headers['content-type'] || '' },
    };
  });
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

function filenameFromDisposition(value = '') {
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return value.match(/filename="?([^";]+)"?/i)?.[1] || '';
}

function filenameFromUrl(value) {
  try { return decodeURIComponent(new URL(value).pathname.split('/').pop() || ''); }
  catch { return ''; }
}

function safeFilename(value) {
  const cleaned = value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  return cleaned.slice(0, 180) || 'downloaded-resource';
}

function folderDownloadUrl(activityId) {
  const url = new URL('/mod/folder/download_folder.php', config.baseUrl);
  url.searchParams.set('id', String(activityId));
  return url.toString();
}
