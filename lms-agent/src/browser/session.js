import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { config } from '../config.js';
import { ensureAuthenticated } from './login.js';

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
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  const overview = page.locator(
    '[data-region="course-content"], [data-region="course-overview"], .block_myoverview',
  ).first();
  await overview.waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {});
  await overview.scrollIntoViewIfNeeded().catch(() => {});
  await page.locator(
    '[data-region="course-content"] a[href*="/course/view.php?id="], ' +
    '[data-region="course-overview"] a[href*="/course/view.php?id="], ' +
    '.block_myoverview a[href*="/course/view.php?id="]',
  ).first().waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
}
