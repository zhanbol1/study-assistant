# Study Assistant

A chat-only desktop study assistant built with Electron, React, TypeScript and SQLite. Windows is the primary target.

Ask questions such as:

- "What is my homework?"
- "Do I have any quizzes this week?"
- "What are the deadlines for my calculus course?"
- "Explain this concept" or "Make a practice quiz from my notes."

The assistant chooses read-only Moodle tools, discovers your visible courses, reads relevant homework and quiz pages, and returns an answer with expandable sources and Moodle links. There is no sidebar, dashboard, task editor or routines page. ChatGPT/API connections and Moodle time-zone settings sit below the chat composer. Existing database records and credentials remain compatible; old scheduled routines and notifications no longer run.

## Run

Requires Node.js 22.13 or newer and npm:

```powershell
npm.cmd install
npm.cmd start
```

`start` builds the interface and launches Electron. This is a development build, without an installer. `npm.cmd run dev` enables live UI updates.

## Connect AI

Expand **Connections** beneath the message box. Use **Continue with ChatGPT** to authorize an eligible plan in your browser, or enter an OpenAI API key and model under **OpenAI connection**. The active connection is displayed under chat. Model availability and plan eligibility are determined by OpenAI.

ChatGPT authorization uses the [official local sign-in flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), with state, PKCE, nonce and signed identity validation. Select a model from your account's catalog after authorization. You can also run `npm.cmd run connect:chatgpt` to start sign-in. This authorizes an existing plan; it does not purchase a subscription. Sign-out removes local tokens and attempts remote revocation. Tokens refresh when needed and remain encrypted using Electron's OS-backed `safeStorage`.

ChatGPT mode uses your plan allowance and never silently switches to API billing. API-key mode has separate API billing; its default model is `gpt-4.1-mini`. Keys are stored using OS-backed encryption; plaintext fallback is refused. `OPENAI_API_KEY` takes precedence only in API-key mode. Changing connection mode, disconnecting or signing out cancels the current request. **Manage ChatGPT usage** opens account usage settings.

## Connect Moodle

Run from the project folder in your own Windows terminal:

```powershell
npm.cmd run lms:install
npm.cmd run lms:browser
npm.cmd run credentials:set
```

Enter your Moodle credentials in the local prompt, never in chat. They are stored in Windows Credential Manager. Under chat's **Connections**, set **Moodle display time zone** to match your Moodle profile, for example `Asia/Bishkek`.

Then ask about homework or quizzes. No manual import or sync is needed. The assistant calls `list_courses`, then `get_coursework` for relevant discovered course IDs. Each user message gets fresh data; repeated reads of the same course within that message reuse that turn's result. Sources record when they were checked. The UI shows lookup progress and provides **Stop response**.

The reader targets `https://ucasaslms.org/` and can only read courses and assignment/quiz pages. It cannot upload, submit work, answer a Moodle quiz, change grades or follow arbitrary URLs. Moodle may record accesses or activity completion according to its own rules. Credentials and browser cookies are not supplied to AI.

Only the rendered Moodle course overview and visible activities can be checked. Filters, pagination, hidden content, unavailable details and login requirements can limit coverage. Headless login may fail when SSO/MFA requires interaction. Each operation opens a fresh browser. A course may contain up to 200 activities; each worker has a ten-minute timeout, and the whole chat request has a fifteen-minute limit. Tool calls and rounds are bounded. A broad lookup can take several minutes; ask about a specific course to narrow it.

Visible coursework is not necessarily outstanding work: submission/completion status is not checked, and old activities may remain visible. Quiz titles containing "exam", "midterm" or "final" are categorized as exams. Availability windows are not necessarily an exam sitting. Missing, ambiguous, conflicting, unsupported or unreadable deadlines stay unknown. The reader recognizes machine timestamps, ISO timestamps and explicit English dates with a clock time, interpreted in the configured Moodle zone when needed. Failed reads are returned as errors, not empty coursework lists. Check important details using the cited Moodle links.

Remove stored credentials with `npm.cmd run credentials:delete`. See the [LMS agent guide](lms-agent/README.md) for standalone commands. The optional bridge is not needed by the desktop app.

## Chat, materials and data

The **Materials** menu lets you import UTF-8 `.txt` or `.md` notes and select which documents to include in your next message. Existing notes remain selectable. Import is limited to 500 KB per file, 120,000 characters per document and 100 documents. Retrieval selects up to eight relevant text passages. PDF/Word extraction and Moodle resource downloads into chat are not implemented.

Each request sends your prompt, up to twelve recent chat messages and excerpts from selected notes to your active AI provider. When your question needs Moodle, requested course names, activity descriptions, deadlines and source links are also shared. Earlier answers may retain information from previous selections. **New chat** clears local conversation history; it does not delete materials or credentials. Chat is capped at 100 saved messages. Practice quizzes can be answered and scored inline; choices/scores reset on reload.

Both connections use the public [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses), structured answers and `store: false`. Subscription requests use streaming and namespaced function tools. The tool loop replays response items, including encrypted reasoning, together with function results. An answer is saved only after a successful completed response and citation validation. Disabling response storage is not a blanket zero-retention guarantee. AI can still make mistakes; references show the supplied evidence, not independent verification of every claim.

Desktop data lives in Electron's `userData` folder, normally `%APPDATA%\Study Assistant`. `study.sqlite` stores records and chat; encrypted AI credentials are separate. Coursework records and chat are not encrypted by the app. The sandboxed renderer has no Node.js, direct filesystem, credential-read or unrestricted IPC access. The Moodle worker does not receive an API key. Do not commit credentials, tokens, browser profiles, downloaded content or discovery artifacts.

## Preview and checks

```powershell
npm.cmd run preview
```

Open `http://127.0.0.1:4173` to inspect the responsive chat UI. Browser preview has separate local storage and cannot connect accounts, use AI/Moodle or import native files.

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run test:desktop
npm.cmd run test:ui
npm.cmd run test:coursework
```

`test:ui` requires the preview server. It checks the single-chat layout, inline connections, prompt suggestions, honest disconnected state and responsive widths. Its screenshot is `.runtime/chat.png`.

Unit tests cover storage compatibility, deadline extraction, retrieval, encrypted credentials, OAuth verification, streaming, tool argument validation, discovered-course restrictions, multiple tool rounds, fresh reads, source links, cancellation and bounded execution. Legacy scheduler unit tests remain for retained historical code; the app no longer starts that scheduler.

`test:desktop` uses an isolated `.runtime/desktop-smoke` profile and mocked provider endpoints. It exercises the real sandboxed renderer/IPC, encrypted key setup, selected materials, chat persistence, actual OAuth callback with a signed fixture identity, subscription models/SSE and explicit billing. It contacts neither OpenAI nor Moodle.

Optional live checks: `npm.cmd run test:moodle:live` reads your Moodle account and prints counts; `npm.cmd run test:ai:live` requires an environment API key and sends a billed generic prompt. Offline tests do not use your real accounts.

## Architecture

```text
src/                        Single chat UI and typed renderer API
desktop/main.mjs            Validated IPC and cancellable Moodle workers
desktop/ai.mjs              Credentials, retrieval, Responses transport and tool loop
desktop/moodle-tools.mjs    Read-only tool schemas, validation and source registry
desktop/response-stream.mjs Completed SSE reconstruction
desktop/chatgpt-auth.mjs    Verified ChatGPT authorization and token lifecycle
desktop/store.mjs           Compatible SQLite records and imports
lms-agent/src/browser/      Moodle authentication and coursework readers
test/ and scripts/         Unit, browser, native and live checks
```

## License

A project license has not been selected. Public source availability alone does not grant an open-source license.
