import { getLmsCredential } from '../security/credential-store.js';
import { openMoodlePage } from './navigation.js';
import { MoodleError } from './errors.js';

const usernameSelectors = [
  'input[name="username"]',
  'input[type="email"]',
  'input[autocomplete="username"]',
];

const passwordSelectors = [
  'input[name="password"]',
  'input[type="password"]',
  'input[autocomplete="current-password"]',
];

export async function ensureAuthenticated(page, destinationUrl, { getCredential = getLmsCredential, loginTimeout = 45000 } = {}) {
  await openMoodlePage(page, destinationUrl);
  const expected = new URL(destinationUrl);
  if (new URL(page.url()).origin !== expected.origin) throw new MoodleError('login-external');
  const loginForm = await page.locator('input[name="password"], input[autocomplete="current-password"]').first().isVisible().catch(() => false);
  if (!looksLikeLoginPage(page) && !loginForm) return;
  try { await page.locator('input[name="password"], input[type="password"], input[autocomplete="current-password"]').first().waitFor({ state: 'visible', timeout: 15000 }); }
  catch { throw new MoodleError('login-incomplete'); }

  const credential = await getCredential();
  try {
    const username = await firstVisible(page, usernameSelectors);
    const password = await firstVisible(page, passwordSelectors);
    if (!username || !password) {
      throw new MoodleError('login-incomplete');
    }

    await username.fill(credential.username);
    await password.fill(credential.password);

    const submit = page.getByRole('button', { name: /log\s*in|sign\s*in|continue/i }).first();
    if (await submit.isVisible().catch(() => false)) await submit.click({ noWaitAfter: true });
    else await password.press('Enter', { noWaitAfter: true });

    await Promise.race([
      page.waitForURL((url) => !url.pathname.toLowerCase().includes('/login'), { timeout: loginTimeout, waitUntil: 'commit' }).catch(() => {}),
      page.locator('#loginerrormessage, .loginerrors').filter({ hasText: /\S/ }).first().waitFor({ state: 'visible', timeout: loginTimeout }).catch(() => {}),
    ]);
    if (new URL(page.url()).origin !== expected.origin) throw new MoodleError('login-external');
    if (looksLikeLoginPage(page)) {
      const rejected = await page.locator('#loginerrormessage, .loginerrors').filter({ hasText: /\S/ }).first().isVisible().catch(() => false);
      throw new MoodleError(rejected ? 'login-rejected' : 'login-incomplete');
    }
    // Some Moodle login flows land on the dashboard rather than the requested course.
    // Revisit the requested read-only page after authentication so an empty dashboard
    // cannot be mistaken for an empty course.
    if (page.url() !== expected.href) await openMoodlePage(page, destinationUrl);
    else await page.locator('#region-main').waitFor({ state: 'attached', timeout: 25000 });
    if (looksLikeLoginPage(page) || await page.locator('input[name="password"]').first().isVisible().catch(() => false)) throw new MoodleError('login-incomplete');
  } finally {
    credential.username = '';
    credential.password = '';
  }
}

function looksLikeLoginPage(page) {
  const pathname = new URL(page.url()).pathname.toLowerCase();
  return pathname.includes('/login');
}

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}
