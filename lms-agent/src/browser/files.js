import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { cleanText } from '../security/sanitize.js';
import { withAuthenticatedPage } from './session.js';
import { normalizeActivities } from './activities.js';
import { openMoodlePage } from './navigation.js';
import { MoodleError } from './errors.js';

export async function requestMoodleFile(context, url, { timeout = 60000 } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // PPTX/ZIP files are already compressed. Avoid unnecessary HTTP compression.
      return await context.request.get(url, { timeout, maxRedirects: 0, headers: { 'Accept-Encoding': 'identity' } });
    } catch (error) {
      const timedOut = /timeout|timed out/i.test(error.message || '');
      const transient = timedOut || /ECONNRESET|net::ERR_(?:CONNECTION_RESET|CONNECTION_CLOSED)/.test(error.message || '');
      if (transient && attempt === 0) continue;
      throw new MoodleError(timedOut ? 'download-timeout' : 'network-error');
    }
  }
}

const numeric = value => { if (!/^\d{1,15}$/.test(String(value))) throw new Error('Invalid Moodle ID.'); };
const courseUrl = id => `${config.baseUrl.replace(/\/$/, '')}/course/view.php?id=${id}`;
async function activitiesOn(page, courseId) {
  const url = new URL(page.url());
  if (url.origin !== new URL(config.baseUrl).origin || url.pathname !== '/course/view.php' || url.searchParams.get('id') !== String(courseId)) throw new Error('The requested course did not open.');
  await page.locator('#region-main').waitFor();
  await page.locator('.course-content').first().waitFor({ state: 'attached', timeout: 20000 });
  return normalizeActivities(await page.locator('#region-main a[href*="/mod/"], .course-content a[href*="/mod/"]').evaluateAll(links => links.map(link => ({ href: link.href, title: link.innerText }))));
}
const resourceFile = activity => ({ id: `activity:${activity.id}`, activityId: activity.id, title: activity.title, type: activity.type, sourceUrl: activity.url });

export function normalizeFileLinks(links, activity) {
  const result = new Map();
  for (const link of links) {
    let url;
    try { url = new URL(link.href, config.baseUrl); } catch { continue; }
    if (url.origin !== new URL(config.baseUrl).origin || url.username || url.password || !/^\/pluginfile\.php\/\d+\//.test(url.pathname)) continue;
    url.hash = ''; url.search = '?forcedownload=1';
    const id = `attachment:${createHash('sha256').update(url.href).digest('hex').slice(0, 24)}`;
    let filename;
    try { filename = decodeURIComponent(url.pathname.split('/').pop()); } catch { filename = ''; }
    result.set(id, { id, activityId: activity.id, title: cleanText(link.title).slice(0, 200) || filename || 'Attached file', filename, type: activity.type === 'folder' ? 'folder_file' : 'attachment', sourceUrl: activity.url, url: url.href });
  }
  return [...result.values()];
}
export async function filesForActivity(page, activity) {
  if (activity.type === 'resource') return [resourceFile(activity)];
  if (!['assign', 'quiz', 'folder'].includes(activity.type)) throw new Error('This activity does not expose downloadable attachments.');
  await openMoodlePage(page, activity.url);
  const url = new URL(page.url());
  if (url.origin !== new URL(config.baseUrl).origin || url.pathname !== `/mod/${activity.type}/view.php` || url.searchParams.get('id') !== activity.id) throw new Error('The requested activity did not open.');
  await page.locator('#region-main').waitFor();
  if (activity.type === 'folder') await page.locator('#region-main .foldertree, #region-main [role="tree"], #region-main [id^="folder_tree"]').first().waitFor({ state: 'attached', timeout: 15000 });
  const selector = activity.type === 'folder' ? '#region-main a[href*="/pluginfile.php/"]' : '#intro a[href*="/pluginfile.php/"], .activity-description a[href*="/pluginfile.php/"]';
  const links = await page.locator(selector).evaluateAll(links => links.map(link => ({ href: link.href, title: link.textContent })));
  const files = normalizeFileLinks(links, activity);
  if (files.length > 200) throw new Error('Too many attachments in this activity.');
  return activity.type === 'folder' ? [resourceFile(activity), ...files] : files;
}
export async function listCourseFiles(courseId, activityId = null) {
  numeric(courseId); if (activityId !== null) numeric(activityId);
  return withAuthenticatedPage(courseUrl(courseId), async page => {
    const activities = await activitiesOn(page, courseId);
    if (activityId === null) return { files: activities.filter(item => ['resource', 'folder'].includes(item.type)).map(resourceFile) };
    const activity = activities.find(item => item.id === String(activityId));
    if (!activity) throw new Error('Activity was not found inside the selected course.');
    return { files: await filesForActivity(page, activity) };
  });
}

export function safeDownloadName(name, activityId, unique = randomUUID().slice(0, 8)) {
  const safe = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 150) || 'resource';
  return `${activityId}-${unique}-${safe}`;
}
function responseFilename(headers, url) {
  const encoded = headers['content-disposition']?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) { try { return decodeURIComponent(encoded); } catch { /* fall back */ } }
  const name = headers['content-disposition']?.match(/filename="?([^";]+)"?/i)?.[1];
  if (name) return name;
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop()) || 'resource'; } catch { return 'resource'; }
}
export async function downloadCourseFile(courseId, activityId, fileId) {
  numeric(courseId); numeric(activityId);
  return withAuthenticatedPage(courseUrl(courseId), async (page, context) => {
    const activity = (await activitiesOn(page, courseId)).find(item => item.id === String(activityId));
    if (!activity) throw new Error('Activity was not found inside the selected course.');
    const available = fileId === `activity:${activity.id}` && ['resource', 'folder'].includes(activity.type) ? [resourceFile(activity)] : await filesForActivity(page, activity);
    const file = available.find(file => file.id === fileId);
    if (!file) throw new Error('File is no longer available in this activity. List files again.');
    let requestUrl = file.type === 'folder' ? new URL(`/mod/folder/download_folder.php?id=${activity.id}`, config.baseUrl).href : file.url || activity.url;
    let response;
    for (let redirect = 0; redirect <= 5; redirect++) {
      const url = new URL(requestUrl);
      if (url.origin !== new URL(config.baseUrl).origin || url.username || url.password) throw new Error('External file downloads are not supported. Open this resource in Moodle.');
      response = await requestMoodleFile(context, url.href);
      if (![301, 302, 303, 307, 308].includes(response.status())) break;
      const location = response.headers().location;
      await response.dispose(); response = null;
      if (!location || redirect === 5) throw new Error('Resource redirect could not be followed.');
      requestUrl = new URL(location, url).href;
    }
    if (!response?.ok()) { await response?.dispose(); throw new Error('Resource download failed.'); }
    try {
      const headers = response.headers();
      if (/text\/html/i.test(headers['content-type'] || '') && !headers['content-disposition']) throw new Error('Moodle returned a page instead of a file. Login or access may need attention.');
      if (Number(headers['content-length']) > 100 * 1024 * 1024) throw new Error('Resource exceeds the 100 MB limit.');
      const body = await response.body();
      if (body.byteLength > 100 * 1024 * 1024) throw new Error('Resource exceeds the 100 MB limit.');
      const filename = safeDownloadName(responseFilename(headers, response.url()), activity.id);
      const outputPath = path.join(config.downloadsDir, filename);
      await fs.writeFile(outputPath, body, { flag: 'wx' });
      return { activity, file: { path: outputPath, filename, bytes: body.byteLength, contentType: headers['content-type'] || '' } };
    } finally { await response.dispose(); }
  });
}
