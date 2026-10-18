import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, "lms-agent/.playwright-browsers");
const { chromium } = await import("../lms-agent/node_modules/playwright/index.mjs");
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:4173");
  await page.getByLabel("Message", { exact: true }).waitFor();
  assert.equal(await page.locator("aside, nav").count(), 0);
  await page.getByRole("button", { name: "What is my homework?" }).click();
  assert.equal(await page.getByLabel("Message", { exact: true }).inputValue(), "What is my homework?");
  await page.getByLabel("Message", { exact: true }).press("Enter");
  await page.getByRole("alert").filter({ hasText: "desktop app" }).waitFor();
  await page.getByRole("heading", { name: "Use your ChatGPT subscription" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Continue with ChatGPT" }).isDisabled(), true);
  assert.equal(await page.getByLabel("API key", { exact: true }).isDisabled(), true);
  await page.getByLabel("Moodle display time zone").fill("Asia/Bishkek");
  await page.getByRole("button", { name: "Save time zone" }).click();
  await page.getByText("Moodle time zone saved.", { exact: true }).waitFor();
  await page.reload();
  await page.locator(".connections > summary").click();
  assert.equal(await page.getByLabel("Moodle display time zone").inputValue(), "Asia/Bishkek");
  await page.locator(".connections > summary").click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await fs.mkdir(path.join(root, ".runtime"), { recursive: true });
  await page.screenshot({ path: path.join(root, ".runtime/chat.png"), fullPage: true });
  for (const width of [390, 768, 1360]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator(".connections > summary").click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator(".connections > summary").click();
  }
  assert.deepEqual(errors, []);
  console.log("UI checks passed: chat-only layout, prompt suggestions, inline connections, honest preview state, time-zone persistence and responsive layouts.");
} finally { await browser.close(); }
