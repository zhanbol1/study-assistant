import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { config } from '../config.js';
import { ensureAuthenticated } from './login.js';
import { MoodleError } from './errors.js';

export async function withAuthenticatedPage(destinationUrl, operation) {
  await fs.mkdir(config.artifactsDir, { recursive: true });
  await fs.mkdir(config.downloadsDir, { recursive: true });

  const browser = await chromium.launch({ headless: config.headless });
  try {
    const context = await browser.newContext({
      acceptDownloads: true,
      downloadsPath: config.downloadsDir,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(config.timeoutMs);
    await ensureAuthenticated(page, destinationUrl);
    return await operation(page, context);
  } finally {
    await browser.close();
  }
}

export async function waitForMoodleContent(page) {
  const overview = page.locator(
    '[data-region="course-content"], [data-region="course-overview"], .block_myoverview',
  ).first();
  try {
    await overview.waitFor({ state: 'attached', timeout: 20000 });
    await page.waitForFunction(() => {
      const area = document.querySelector('[data-region="course-content"], [data-region="course-overview"], .block_myoverview');
      if (!area) return false;
      if (area.querySelector('a[href*="/course/view.php?id="]')) return true;
      return [...area.querySelectorAll('[data-region="empty-message"], .no-courses, .nocourses, [data-region="no-courses"]')].some(node => !node.hidden && node.getClientRects().length && getComputedStyle(node).display !== 'none');
    }, undefined, { timeout: 45000 });
  } catch { throw new MoodleError('courses-not-loaded'); }
}
