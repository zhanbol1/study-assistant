# Study Assistant

A local desktop study workspace, starting with Windows and structured for future macOS and Linux support. The interface uses the working name **Studyspace**.

## What works now

- Overview with task counts, a seven-day calendar, search, and status filters.
- Add homework, exams, quizzes, and study sessions with optional deadlines and notes.
- Edit task titles, courses, types, deadlines, and notes; complete, reopen, and remove tasks. Deadlines entered in local time are stored as UTC.
- Save study routine instructions locally.
- Sync visible UCA Moodle courses and import assignment titles, sections, and source links using the existing Playwright agent.
- Keep local completion state and edited fields when importing assignments again.
- Open validated course and assignment links in the default browser.
- Persist desktop records in SQLite under the operating system's application-data folder.

AI sign-in/chat, automatic deadline and exam extraction, document search, demonstrated browser routines, routine execution, notifications, and background scheduling are **not implemented yet**. Routines currently store instructions only. This is a development build, not a packaged installer.

## Run the desktop app

Requires Node.js **22.13 or newer** and npm. Windows is required for the existing Moodle credential helper; local task management is designed to work across platforms but has not yet been validated on macOS or Linux.

From the repository root:

```powershell
npm.cmd install
npm.cmd start
```

`start` builds the React interface and launches Electron. Electron may download its platform binary on the first launch. The desktop workspace starts empty; it never loads the browser preview's sample tasks.

For development with live updates:

```powershell
npm.cmd run dev
```

The development server is restricted to `127.0.0.1:5173`.

## Connect Moodle

Run the following from your own Windows terminal under the account that will run the app:

```powershell
npm.cmd run lms:install
npm.cmd run lms:browser
npm.cmd run credentials:set
```

Open **Courses → Sync courses**, then choose **Import assignments** on an individual course. Each operation opens a visible browser and signs in as needed. Manual interaction is possible during recognized login flows, but general SSO/MFA support is not guaranteed. No bridge terminal is needed: Electron manages a separate Moodle worker.

Sync happens only when requested, one operation at a time. The app currently targets `https://ucasaslms.org/`; it does not support entering arbitrary Moodle servers. Moodle course filters and pagination can limit which courses are visible.

Assignment imports do not retrieve due dates, exam dates, descriptions, or submissions. Imported tasks start with an unknown deadline, with a source link to check Moodle. Open a task and choose **Edit task** to record a deadline or add study notes; these edits remain local and survive later imports. Missing links in a later import do not automatically delete previously imported tasks. Marking a task complete changes this local workspace only.

Remove stored credentials:

```powershell
npm.cmd run credentials:delete
```

See the [LMS agent README](lms-agent/README.md) for its standalone commands and security limitations.

## Browser preview

```powershell
npm.cmd run preview
```

Open `http://127.0.0.1:4173`. The browser preview is explicitly labeled and contains sample tasks. Its changes are stored in browser local storage, independently of desktop SQLite. Moodle sync is disabled there. The preview is for inspecting the interface, not hosting a multi-user app.

## Architecture

```text
src/                     React + TypeScript interface
desktop/bootstrap.cjs    Synchronous Electron entry point and startup errors
desktop/main.mjs         Window lifecycle and validated IPC handlers
desktop/preload.cjs      Narrow interface exposed to the sandboxed renderer
desktop/store.mjs        SQLite persistence and import reconciliation
desktop/validation.mjs   Input and Moodle link validation
desktop/moodle-worker.mjs Isolated process reusing the LMS agent
lms-agent/               Existing Node.js + Playwright Moodle integration
test/                    Persistence, validation, and sync regression tests
scripts/                 Development and Chromium setup helpers
```

Desktop data is stored in `study.sqlite` within Electron's `userData` directory (normally `%APPDATA%\Study Assistant` on Windows). Worker artifacts use a `moodle` subdirectory there. Records are not encrypted by the app. The renderer has no direct Node.js, filesystem, credential, or unrestricted IPC access. No AI provider is connected and no AI requests are made.

## Checks

```powershell
npm.cmd run build
npm.cmd test
```

The build runs TypeScript checking and Vite production compilation. Tests cover SQLite persistence, time-zone normalization, import deduplication, completion preservation, invalid payload handling, external-link restrictions, and the original agent's sanitization/normalization checks. Live Moodle authentication and website compatibility require manual validation with your account.

With the browser preview running and the agent's Chromium installed, run `npm.cmd run test:ui` in another terminal to check task creation, completion, browser persistence, routine creation, connection errors, and responsive layouts. This check uses an isolated browser session with sample data and does not contact Moodle. Its screenshot is saved to `.runtime/overview.png`.

Run `npm.cmd run test:desktop` to check native window startup, the preload connection, and SQLite access. This requires the Electron binary and Windows permissions that allow Electron's sandboxed child processes to read it. The check hides its window, uses a separate `.runtime/desktop-smoke` workspace, and does not contact Moodle.

## Private local data

Do not commit credentials, API keys, tokens, browser profiles, downloaded materials, or discovery artifacts. Git ignore rules exclude dependencies, local browser binaries, caches, runtime artifacts, build output, SQLite databases, and the agent's downloads and artifacts. Review files before publishing.

## Next milestones

1. Validate course and assignment sync against representative live courses.
2. Extract assignment deadlines, quiz windows, and announcement evidence.
3. Add supported AI authentication and a provider-independent tool interface.
4. Add document retrieval, study chat, and practice quizzes.
5. Extend saved instructions into tested browser routines and scheduled reminders.
6. Package installers and validate each target operating system.

## License

A project license has not yet been selected. Public source availability alone does not grant an open-source license.
