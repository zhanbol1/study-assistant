# Study Assistant

A local desktop study workspace built with Electron, React, TypeScript, and SQLite. The interface uses the working name **Studyspace**. Windows is the primary target; Moodle credentials currently use Windows Credential Manager.

## Features

- Create, edit, complete, reopen, search, filter, and delete tasks; view a seven-day calendar.
- Import UCA Moodle courses, assignments, and quizzes, including descriptions and explicit deadlines or quiz availability windows, with source evidence.
- Preserve completion and locally edited fields across imports. Failed detail reads retain earlier dates; missing links do not delete tasks.
- Connect an eligible ChatGPT subscription or an OpenAI API account, chat about selected materials or optional task context, and generate practice quizzes with scoring and explanations.
- Paste study notes or import UTF-8 `.txt` / `.md` files. Search material text locally and select which materials to share with AI.
- Run study reminders and read-only coursework checks manually, hourly, daily, or weekly. See next run, last run, and failures.
- Enable deadline reminders, desktop notifications, a persistent reminder inbox, and continued operation in the system tray.

This is a development build, not a packaged installer. Browser demonstrations, arbitrary instruction-driven browser automation, PDF/Word extraction, and automatic launch at OS login are not implemented.

## Run

Requires Node.js **22.13 or newer** and npm.

```powershell
npm.cmd install
npm.cmd start
```

`start` checks and builds the interface, then launches Electron. Electron may download its binary on first installation. Desktop records start empty and never use the preview's sample data.

Use `npm.cmd run dev` for live UI updates. The development server binds to `127.0.0.1:5173`.

## Moodle

From your own Windows terminal, under the account that runs the app:

```powershell
npm.cmd run lms:install
npm.cmd run lms:browser
npm.cmd run credentials:set
```

In **Settings**, set **Moodle display time zone** to match your Moodle profile, for example `Asia/Bishkek`. This is used when dates have no UTC offset. Machine timestamps and ISO dates with explicit offsets do not depend on that setting.

Open **Courses → Sync courses**, then **Import coursework** on a course. Manual sync opens a browser so you can finish recognized login steps. The app targets `https://ucasaslms.org/` and does not edit courses, upload files, attempt quizzes, or submit assignments. Moodle may record accesses or activity completion according to its own rules.

Course filters and pagination can limit the visible course list. An import reads up to 200 assignment/quiz detail pages, with an overall worker timeout of ten minutes. Unreadable details are marked in source evidence. Quiz titles containing “exam”, “midterm”, or “final” are categorized as exams; imported opening/closing times describe availability, not necessarily an exam sitting.

The reader supports machine timestamps, ISO timestamps, and English dates containing a full date and clock time. Ambiguous numeric dates, relative dates, conflicting dates, unsupported translations, and ambiguous daylight-saving times stay unknown. It does not infer deadlines from announcements or arbitrary prose. Use **Task details → Edit task** to correct dates. Dates are stored in UTC and displayed in your device's local time.

Remove stored Moodle credentials with `npm.cmd run credentials:delete`. The [LMS agent guide](lms-agent/README.md) covers standalone commands and the optional local bridge. The desktop app uses its own worker and does not require the bridge.

## AI and study materials

1. Open **Settings → Use your ChatGPT subscription → Continue with ChatGPT**, or configure your own API key under **OpenAI connection**.
2. Open **Assistant**, paste notes or import a `.txt` / `.md` file, and select materials.
3. Enter a question and choose **Send**, or enter a topic and choose **Make practice quiz**.
4. Select quiz answers and choose **Check answers** for scoring and explanations.

To open the app and start subscription sign-in directly, run `npm.cmd run connect:chatgpt`. Complete authentication and plan authorization in your system browser. The app uses the [documented local ChatGPT sign-in flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), verifies the identity signature, issuer, audience, expiry, and nonce, and binds the callback to random state and PKCE. Sign-in expires after five minutes and can be cancelled. The app does not buy or upgrade a subscription; OpenAI determines account/workspace eligibility.

After authorizing plan usage, choose a model from the account-specific catalog in Settings. **Using ChatGPT plan** is shown near chat. Requests use your existing plan allowance, and **Manage usage** opens ChatGPT's usage settings. A missing grant, eligibility restriction, or usage limit stops the request; it never silently switches to API billing. A valid identity without plan permission remains signed in and can request permission again. Only the active account is retained. Use **Use another account** to replace it after validation, or **Sign out of ChatGPT** to revoke and remove local tokens.

ChatGPT credentials are kept in an encrypted, atomically written `chatgpt-session.bin` in the app-data folder, with a stable opaque installation ID. Access tokens renew through serialized refreshes; temporary failures preserve the connection, while terminal renewal failures require sign-in again. Sign-out retains the installation ID and account/client mapping, removes tokens, and reports if remote revocation could not be confirmed. No ChatGPT conversation history is imported.

API-key mode remains available as an explicit alternative. API billing belongs to your OpenAI account. The API model defaults to `gpt-4.1-mini`; a saved key is verified on the first request. Keys use operating-system-backed `safeStorage`; plaintext fallback backends are refused. `OPENAI_API_KEY` takes precedence over the saved key **only in API-key mode**. Remove that variable and restart to disconnect an environment key. Changing connection modes or signing out cancels an active request.

Search is local keyword retrieval. Each AI request sends the question, up to twelve recent messages, up to eight relevant passages from selected materials, and task details only if **Share my task titles, notes, deadlines, and source links** is checked. Earlier answers can contain information from previous selections; clear chat to start a separate conversation. Source references identify supplied passages, but do not independently verify AI claims. Review answers and quiz answers against your materials.

Both modes use the [OpenAI Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses) with `store: false` and [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). Subscription requests use the public endpoint with the [required streaming format](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference); unsupported API-only fields are omitted, and no answer is saved until `response.completed`. Disabling response storage is not a blanket zero-retention guarantee. Local chat history is capped at 100 messages. **Clear chat** removes it. Quiz questions persist; selected answers and scores reset when reopening the screen.

Materials are limited to 100 documents, 120,000 characters each; imported files must be under 500 KB. Files stay local until selected excerpts are sent. Remove materials using their trash buttons. PDF, Word, OCR, and automatic resource downloads into the AI library are not supported.

## Routines and reminders

Create a **Study reminder** or **Import Moodle coursework** routine. Coursework checks require a synced course. Instructions are reminder text, not executable browser commands. Existing instruction-only routines become manual study reminders.

Choose **Run now** or an hourly, daily, or weekly schedule. Schedules are elapsed intervals from saving or completing a run. After sleep or restart, an overdue routine runs once and advances its next run. Failed runs record an error and wait until the next interval. Automatic Moodle checks use a headless browser; if login needs interaction, use a manual course import.

Enable deadline reminders and choose a lead time in **Settings**. Checks run approximately every 30 seconds. Reminders cover upcoming deadlines inside that lead time and recently overdue tasks (up to 24 hours). Completed tasks are skipped. Delivery is deduplicated across restarts; the inbox keeps the latest 200 notices. OS settings may suppress desktop toasts; the inbox remains available.

Enable **Keep running in the system tray** to continue after closing the window. Open or quit the app from the tray menu. Nothing runs after **Quit**; this build does not register an OS login task. A single normal app instance avoids duplicate schedules. No AI requests are scheduled automatically.

## Browser preview

```powershell
npm.cmd run preview
```

Open `http://127.0.0.1:4173`. The labeled preview contains sample tasks and stores changes in browser local storage, separately from desktop SQLite. Moodle, API-key storage, AI requests, native file import, routine execution, and scheduling require the desktop app. This preview is for inspecting the interface, not hosting a multi-user service.

## Architecture and data

```text
src/                        React interface and typed API
desktop/bootstrap.cjs       Electron startup and single-instance lock
desktop/main.mjs            Validated IPC, workers, notifications, tray
desktop/preload.cjs          Narrow sandboxed renderer bridge
desktop/store.mjs            SQLite records and import reconciliation
desktop/validation.mjs       Inputs, settings, and Moodle URL validation
desktop/ai.mjs               Encrypted key vault, retrieval, Responses transport
desktop/scheduler.mjs        Reminders and recurring routines
desktop/moodle-worker.mjs    Isolated Moodle process
lms-agent/src/browser/      Browser authentication and coursework readers
test/                       Storage, dates, AI, and schedule regression tests
scripts/                    Development and browser/native/live checks
```

`study.sqlite` lives in Electron's `userData` folder (normally `%APPDATA%\Study Assistant` on Windows); encrypted key bytes live beside it as `openai-key.bin`. Worker artifacts use a `moodle` subdirectory. Study records and chat are not encrypted by the app. The renderer has no direct Node.js, filesystem, credential-read, or unrestricted IPC access. API keys never enter snapshots or the Moodle worker.

Do not commit credentials, tokens, browser profiles, downloaded materials, or discovery artifacts. Git ignores dependencies, local browsers, caches, runtime artifacts, builds, and SQLite files. Review files before publishing.

## Checks

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run test:coursework
npm.cmd run test:desktop
```

Unit tests cover storage, editing, date normalization and DST ambiguity, validation, retrieval and selection, AI failures, credential storage boundaries, recurring checks, reminder deduplication, and restart behavior. Coursework browser fixtures exercise actual DOM extraction without contacting Moodle.

`test:desktop` uses a hidden native window in `.runtime/desktop-smoke`. It checks encrypted storage, IPC, materials, chat and quiz UI, the actual loopback OAuth callback with a signed fixture identity, subscription model selection and SSE handling, explicit billing modes, reminders, and close-to-tray behavior. Provider endpoints are **mocked**; it contacts neither OpenAI nor Moodle. Unit tests separately check identity validation, callback binding, declined consent, refresh rotation, sign-out, and incomplete or failed streams. Native tests require Electron and Windows permissions for sandboxed processes.

With the preview running, `npm.cmd run test:ui` checks tasks, materials, local search, browser persistence, disconnected AI state, and responsive layouts. Its screenshot is `.runtime/overview.png`.

Optional live checks:

```powershell
npm.cmd run test:moodle:live
npm.cmd run test:ai:live
```

The Moodle check uses your Windows credential, checks up to eight visible courses until it finds two with coursework, and prints counts only. The AI check requires `OPENAI_API_KEY` in that terminal, optionally `OPENAI_MODEL`; it makes one billed study-tip request without coursework. Live checks are separate from offline tests. Never paste credentials into chat or logs.

## License

A project license has not been selected. Public source availability alone does not grant an open-source license.
