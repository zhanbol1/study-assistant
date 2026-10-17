import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { cleanText, sanitizeUrl } from '../security/sanitize.js';
import { waitForMoodleContent, withAuthenticatedPage } from './session.js';

export async function discoverLms() {
  return withAuthenticatedPage(config.coursesUrl, async (page) => {
    await waitForMoodleContent(page);

    const raw = await page.evaluate(() => ({
      title: document.title,
      language: document.documentElement.lang,
      headings: [...document.querySelectorAll('h1, h2, h3')].map((el) => ({
        level: Number(el.tagName.slice(1)),
        text: el.textContent,
      })),
      links: [...document.querySelectorAll('a[href]')].map((el) => ({
        text: el.textContent || el.getAttribute('aria-label') || el.getAttribute('title'),
        href: el.href,
      })),
      forms: [...document.forms].map((form) => ({
        action: form.action,
        method: form.method,
        fields: [...form.elements].map((field) => ({
          name: field.name,
          type: field.type,
          label: field.labels?.[0]?.textContent || field.getAttribute('aria-label'),
        })),
      })),
    }));

    const result = sanitizeDiscovery(raw, page.url());
    const outputPath = path.join(config.artifactsDir, 'discovery.json');
    await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    return { result, outputPath };
  });
}

export function sanitizeDiscovery(raw, pageUrl) {
  const currentUrl = sanitizeUrl(pageUrl);
  return {
    page: {
      title: cleanText(raw.title),
      url: currentUrl,
      language: cleanText(raw.language, 20),
    },
    headings: (raw.headings || []).slice(0, 100).map((heading) => ({
      level: heading.level,
      text: cleanText(heading.text),
    })).filter((heading) => heading.text),
    links: (raw.links || []).slice(0, 500).map((link) => ({
      text: cleanText(link.text),
      href: sanitizeUrl(link.href, currentUrl),
    })).filter((link) => link.text && link.href),
    forms: (raw.forms || []).slice(0, 30).map((form) => ({
      action: sanitizeUrl(form.action, currentUrl),
      method: cleanText(form.method, 12).toUpperCase(),
      fields: (form.fields || []).slice(0, 100).map((field) => ({
        name: isSensitiveName(field.name) ? '[sensitive-field]' : cleanText(field.name, 80),
        type: cleanText(field.type, 30),
        label: cleanText(field.label, 120),
      })),
    })),
  };
}

function isSensitiveName(name = '') {
  return /password|passwd|token|sesskey|secret|auth/i.test(name);
}
