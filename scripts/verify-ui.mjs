// Run `npm run preview` first. Uses the existing agent's Chromium installation.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
  root,
  "lms-agent/.playwright-browsers",
);
const { chromium } = await import(
  "../lms-agent/node_modules/playwright/index.mjs"
);
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1360, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4173");
  await page
    .getByRole("heading", { name: "A little clarity. A better study day." })
    .waitFor();
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('[name="title"]').fill("UI verification exam");
  await dialog.locator('[name="course"]').fill("Verification course");
  await dialog.locator('[name="kind"]').selectOption("exam");
  await dialog.locator('[name="dueAt"]').fill("2026-12-04T14:30");
  await dialog.getByRole("button", { name: "Add task", exact: true }).click();
  await page
    .getByRole("button", { name: "View UI verification exam", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("heading", { name: "UI verification exam" })
    .waitFor();
  await dialog.getByRole("button", { name: "Edit task", exact: true }).click();
  assert.equal(await dialog.locator('[name="dueAt"]').inputValue(), "2026-12-04T14:30");
  await dialog.locator('[name="notes"]').fill("Edited study notes");
  await dialog.locator('[name="dueAt"]').fill("2026-12-05T09:15");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "View UI verification exam", exact: true }).click();
  await dialog.getByText("Edited study notes", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Mark complete", exact: true })
    .click();
  await page.getByRole("button", { name: "Completed", exact: true }).click();
  await page
    .getByRole("button", { name: "View UI verification exam", exact: true })
    .waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Completed", exact: true }).click();
  await page
    .getByRole("button", { name: "View UI verification exam", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "View UI verification exam", exact: true }).click();
  await dialog.getByRole("button", { name: "Edit task", exact: true }).click();
  assert.equal(await dialog.locator('[name="notes"]').inputValue(), "Edited study notes");
  assert.equal(await dialog.locator('[name="dueAt"]').inputValue(), "2026-12-05T09:15");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Study routines", exact: true })
    .click();
  await page.getByRole("button", { name: "New routine", exact: true }).click();
  await page
    .getByRole("dialog")
    .locator('[name="name"]')
    .fill("UI verification routine");
  await page
    .getByRole("dialog")
    .locator('[name="instructions"]')
    .fill("Read the course announcements and collect explicit deadlines.");
  await page.getByRole("button", { name: "Save routine", exact: true }).click();
  await page
    .getByRole("heading", { name: "UI verification routine", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Courses", exact: true }).click();
  await page.getByRole("button", { name: "Sync courses", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Moodle sync is available in the desktop app" })
    .waitFor();
  await page.getByRole("button", { name: "Dismiss error" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page
    .getByText("No AI provider is connected.", { exact: false })
    .waitFor();
  await page.getByRole("button", { name: "Paste notes", exact: true }).click();
  await page.getByLabel("Material title", { exact: true }).fill("Calculus lecture");
  await page.getByLabel("Study notes", { exact: true }).fill("The chain rule differentiates composite functions.");
  await page.getByRole("button", { name: "Save material", exact: true }).click();
  await page.getByRole("checkbox", { name: /Calculus lecture/ }).check();
  await page.getByLabel("Search material text", { exact: true }).fill("composite");
  await page.getByText("The chain rule differentiates composite functions.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isDisabled(), true);
  await page.reload();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByRole("checkbox", { name: /Calculus lecture/ }).waitFor();
  for (const width of [920, 620, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Assistant overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 1360, height: 1000 });
  await page.screenshot({ path: path.join(root, ".runtime/assistant.png"), fullPage: true });
  await page.getByRole("button", { name: "Settings & connections", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Continue with ChatGPT", exact: true }).isDisabled(), true, "Subscription sign-in requires the desktop app");
  assert.equal(await page.getByLabel("API key", { exact: true }).isDisabled(), true, "Preview cannot store credentials");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await fs.mkdir(path.join(root, ".runtime"), { recursive: true });
  await page.screenshot({
    path: path.join(root, ".runtime/overview.png"),
    fullPage: true,
  });
  for (const width of [920, 620, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Horizontal overflow at ${width}px`,
    );
  }
  assert.deepEqual(errors, [], "No uncaught renderer errors");
  console.log(
    "UI checks passed: task editing and persistence, routine creation, sync errors, disconnected AI state, material creation/search/persistence, and responsive overview and assistant layouts.",
  );
} finally {
  await browser.close();
}
