import { MoodleError } from './errors.js';

// Moodle can render its login/course content while ancillary requests keep the
// page's load event pending. Wait for the document and actual Moodle content.
export async function openMoodlePage(page, url, { timeout = 30000 } = {}) {
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { response = await page.goto(url, { waitUntil: 'commit', timeout }); break; }
    catch (error) {
      const transient = error?.name === 'TimeoutError' || /net::ERR_(?:TIMED_OUT|CONNECTION_RESET|CONNECTION_CLOSED|NETWORK_CHANGED)/.test(error.message || '');
      if (transient && attempt === 0) continue;
      throw new MoodleError(error?.name === 'TimeoutError' ? 'network-timeout' : 'network-error');
    }
  }
  if (response?.status() >= 400) {
    const status = response.status();
    throw new MoodleError(status === 429 || status >= 500 ? 'server-unavailable' : 'access-denied', `Moodle returned HTTP ${status}. ${status === 429 ? 'Wait before retrying.' : status >= 500 ? 'The Moodle server is unavailable; try again later.' : 'Check course access in Moodle.'}`);
  }
  try {
    await page.locator('#region-main, input[name="password"], .loginform, #loginerrormessage, .block_myoverview, [data-region="course-overview"], .alert-danger').first().waitFor({ state: 'attached', timeout: 25000 });
  } catch { throw new MoodleError('page-not-ready'); }
  return response;
}
