import { getLmsCredential } from '../security/credential-store.js';

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

export async function ensureAuthenticated(page, destinationUrl) {
  await page.goto(destinationUrl, { waitUntil: 'domcontentloaded' });
  if (!looksLikeLoginPage(page)) return;

  const credential = await getLmsCredential();
  try {
    const username = await firstVisible(page, usernameSelectors);
    const password = await firstVisible(page, passwordSelectors);
    if (!username || !password) {
      throw new Error('Login page detected, but its credential fields were not recognized.');
    }

    await username.fill(credential.username);
    await password.fill(credential.password);

    const submit = page.getByRole('button', { name: /log\s*in|sign\s*in|continue/i }).first();
    if (await submit.isVisible().catch(() => false)) await submit.click({ noWaitAfter: true });
    else await password.press('Enter', { noWaitAfter: true });

    await page.waitForURL((url) => !url.pathname.toLowerCase().includes('/login'), {
      timeout: 60_000,
    }).catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
    if (looksLikeLoginPage(page)) {
      throw new Error('LMS login did not complete. Credentials, MFA, or SSO may require attention.');
    }
    // Some Moodle login flows land on the dashboard rather than the requested course.
    // Revisit the requested read-only page after authentication so an empty dashboard
    // cannot be mistaken for an empty course.
    await page.goto(destinationUrl, { waitUntil: 'domcontentloaded' });
    if (looksLikeLoginPage(page)) throw new Error('LMS login did not persist.');
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
