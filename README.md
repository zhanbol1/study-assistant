# Study Assistant

A desktop study assistant with chat, editable AI Memory, saved sidebar pages and Moodle downloads built with Electron, React, TypeScript and SQLite. Windows is the primary target.

Ask questions such as:

- "What is my homework?"
- "Do I have any quizzes this week?"
- "What are the deadlines for my calculus course?"
- "Explain this concept" or "Make a practice quiz from my notes."

The assistant discovers your visible Moodle courses, reads relevant homework and quiz pages, and returns an answer with sources and Moodle links. The left sidebar contains Chat, Memory, Downloads and pages you ask the AI to save, such as Homework or Overview. ChatGPT/API connections and Moodle time-zone settings remain below the chat composer. Existing records and credentials remain compatible; old scheduled routines and notifications do not run.

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

## Memory and sidebar pages

Open **Memory** in the sidebar to edit the assistant's study instructions. The real UTF-8 file is `memory.md` beside `study.sqlite` in the app-data folder. **Show memory.md in folder** locates it so you can edit it with your own text editor. **Load saved version** rereads external changes. Saves detect conflicting edits rather than silently replacing a newer version.

Memory is included in every AI request, up to 20,000 characters. Use it for course-specific rules, where to look for homework, your definition of finished work, deadline/grace-period preferences and how you want answers organized. The starter file distinguishes submissions, finished quiz attempts, passed deadlines and unknown status. Preferences cannot create missing Moodle evidence. Current chat instructions take precedence over preferences. The AI has no tool to rewrite Memory.

Try **"Create and save a Homework page in the sidebar"**, **"Create an Overview of my study week"**, or **"Update my Homework page from Moodle"**. The assistant can list/read saved pages and create or update them using workspace tools. Pages store Markdown text, source references and update time. Headings, lists, checklists and tables display as formatted text; arbitrary HTML or executable widgets are not supported. These are saved snapshots, not automatic live dashboards. Ask the AI to refresh them when needed.

You can also create, rename, edit and delete pages yourself. Unsaved drafts are protected when navigating away. Updates use revisions so an AI request cannot silently replace edits made while it was working. Limits: 50 pages, 30,000 characters per page. Completed downloads and saved pages remain available if a later AI response fails or is stopped.

## Moodle file downloads

Ask **"Download the files for my homework"** or **"Find and download the lecture slides for this course"**. The assistant lists current course resources or an assignment/quiz's introductory attachments before selecting files to download. Course folders download as ZIPs.

Open **Downloads** in the sidebar for filenames, course, size, source and download time. **Show in folder** reveals the local file; nothing is executed automatically. Desktop files live under `moodle/downloads` in the app-data folder. Downloads use unique names, are limited to 100 MB each and ten files per message, and are revalidated against the course before saving. External download redirects are rejected. Missing or restricted files are reported as failures. Moving/deleting a file outside the app is detected when revealing it.

Downloading alone does not mark an assignment complete or read its contents. The separate slide-reading tool can extract PPTX text and speaker notes; PDF, Word, legacy PPT and folder ZIP extraction are not supported. Explicitly selected text/Markdown notes can still be used through the chat's Materials menu. Downloaded filenames and metadata are available to AI. When you ask the assistant to read lecture slides, requested PPTX text and speaker notes are also sent as cited study material; binary file contents and local filesystem paths are not sent.

## Reading PowerPoint slides in Moodle folders

Ask **"Read the PowerPoint slides in my lecture folder and summarize them"** or **"Find the homework mentioned in the lecture slides"**. The assistant lists course files, opens the relevant Moodle folder, then reads individual `.pptx` files using `read_slides`. Nested folder paths are included when Moodle exposes their file links. Folder ZIPs remain downloadable but are not used as a substitute for reading individual decks.

The reader extracts text, table-cell text and speaker notes in presentation order and returns slide-number references. It does not require Microsoft PowerPoint. Local reading copies appear in Downloads. Slide text is treated as untrusted course material, never as instructions to change Memory or call unrelated tools.

Images, diagrams, embedded charts, equations and animations are not visually interpreted. Image-only slides are identified by missing extracted text and image counts. The assistant must disclose unread ranges and any text truncation. Reading is paginated (up to 20 slides and roughly 24,000 text characters per tool response), with a next-slide pointer. A message can read up to five presentations and return up to 150,000 characters. Each deck is limited to 500 slides and one million extracted characters, with separate compressed-file and XML expansion limits. Malformed, encrypted and unsupported files produce a clear error rather than an invented summary.

Optional account verification: `npm.cmd run test:slides:live` discovers folders, downloads one PPTX into `.runtime/slides-live`, and prints slide/text counts only. It sends no content to an AI provider.

## Connect Moodle

Run from the project folder in your own Windows terminal:

```powershell
npm.cmd run lms:install
npm.cmd run lms:browser
npm.cmd run credentials:set
```

Enter your Moodle credentials in the local prompt, never in chat. They are stored in Windows Credential Manager. Under chat's **Connections**, set **Moodle display time zone** to match your Moodle profile, for example `Asia/Bishkek`.

Then ask about homework or quizzes. No manual import or sync is needed. The assistant calls `list_courses`, then `get_coursework` for relevant discovered course IDs. Each user message gets fresh data; repeated reads of the same course within that message reuse that turn's result. Sources record when they were checked. The UI shows lookup progress and provides **Stop response**.

The reader targets `https://ucasaslms.org/` and can read courses, assignment/quiz pages, and discovered course files. It cannot upload, submit work, answer a Moodle quiz, change grades or follow arbitrary URLs. Moodle may record accesses or activity completion according to its own rules. Credentials and browser cookies are not supplied to AI.

Only the rendered Moodle course overview and visible activities can be checked. Filters, pagination, hidden content, unavailable details and login requirements can limit coverage. Headless login may fail when SSO/MFA requires interaction. Each operation opens a fresh browser. A course may contain up to 200 activities; each worker has a ten-minute timeout, and the whole chat request has a fifteen-minute limit. Tool calls and rounds are bounded. A broad lookup can take several minutes; ask about a specific course to narrow it.

Moodle reads wait for page content rather than unrelated images or background requests. Transient navigation failures, a stalled course overview and stalled file transfers each get one retry. Loading failures, rejected credentials, file-transfer timeouts and server errors are reported separately; a failed course-list read keeps the previous cache. A course without standard assignment/quiz modules may still have homework in lecture files: the assistant is instructed to inspect those files using your Memory rules.

Visible coursework is not necessarily outstanding work. The reader captures explicit English submission-status rows and quiz-attempt state when available: submitted, not submitted, draft, attempt finished, in progress or unknown. A submitted assignment is not necessarily graded; a finished quiz attempt is not necessarily a final result. Missing status stays unknown, and old activities may remain visible. Apply your Memory rules while keeping evidence distinct from personal labels. Quiz titles containing "exam", "midterm" or "final" are categorized as exams. Availability windows are not necessarily an exam sitting. Missing, ambiguous, conflicting, unsupported or unreadable deadlines stay unknown. The reader recognizes machine timestamps, ISO timestamps and explicit English dates with a clock time, interpreted in the configured Moodle zone when needed. Failed reads are returned as errors, not empty coursework lists. Check important details using the cited Moodle links.

Remove stored credentials with `npm.cmd run credentials:delete`. See the [LMS agent guide](lms-agent/README.md) for standalone commands. The optional bridge is not needed by the desktop app.

## Chat, materials and data

The **Materials** menu lets you import UTF-8 `.txt` or `.md` notes and select which documents to include in your next message. Existing notes remain selectable. Import is limited to 500 KB per file, 120,000 characters per document and 100 documents. Retrieval selects up to eight relevant text passages. PDF/Word text extraction is not implemented. Moodle resource downloads are available through chat and the Downloads collection.

Each request sends your saved Memory, prompt, up to twelve recent chat messages and excerpts from selected notes to your active AI provider. When your question needs Moodle, requested course names, activity descriptions, deadlines, source links and extracted PPTX slide text/notes are also shared. Earlier answers may retain information from previous selections. **New chat** clears local conversation history; it does not delete materials or credentials. Chat is capped at 100 saved messages. Practice quizzes can be answered and scored inline; choices/scores reset on reload.

Both connections use the public [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses), structured answers and `store: false`. Subscription requests use streaming and separate Moodle/workspace tool namespaces. Credentials are checked again between provider rounds so a long lookup can renew an expiring session. The tool loop replays response items, including encrypted reasoning, together with function results. An answer is saved only after a successful completed response and citation validation. Disabling response storage is not a blanket zero-retention guarantee. AI can still make mistakes; references show the supplied evidence, not independent verification of every claim.

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
npm.cmd run test:moodle:offline
```

`test:ui` requires the preview server. It checks sidebar navigation, Memory editing and persistence, unsaved-draft protection, saved page CRUD and tables, Downloads, inline connections and responsive widths. Its screenshot is `.runtime/chat.png`.

`test:moodle:offline` uses local HTTP fixtures to check sign-in redirects, stalled images, delayed course cards, rejected credentials, server errors and external sign-in boundaries without accessing your Moodle account.

Unit tests cover storage compatibility, memory.md persistence and external-edit conflicts, saved-page revisions and sources, credential renewal between tool rounds, submission evidence, file discovery, download boundaries, deadline extraction, retrieval, encrypted credentials, OAuth verification, streaming, tool validation, multiple rounds, cancellation and bounded execution. Legacy scheduler unit tests remain for retained historical code; the app no longer starts that scheduler.

`test:desktop` uses an isolated `.runtime/desktop-smoke` profile and mocked provider endpoints. It exercises the real sandboxed renderer/IPC, memory.md editing on disk, AI-created sidebar pages, encrypted key setup, selected materials, chat persistence, actual OAuth callback with a signed fixture identity, subscription models/SSE and explicit billing. It contacts neither OpenAI nor Moodle.

Optional live checks: `npm.cmd run test:moodle:live` reads your Moodle account and prints counts; `npm.cmd run test:ai:live` requires an environment API key and sends a billed generic prompt. Offline tests do not use your real accounts.

## Architecture

```text
src/                        Chat, Memory, Downloads and saved-page UI
desktop/main.mjs            Validated IPC and cancellable Moodle workers
desktop/ai.mjs              Credentials, retrieval, Responses transport and tool loop
desktop/moodle-tools.mjs    Moodle schemas, file discovery and download tools
desktop/workspace-tools.mjs Saved-page tools and citation validation
desktop/memory.mjs          User-editable memory.md and revision checks
desktop/response-stream.mjs Completed SSE reconstruction
desktop/chatgpt-auth.mjs    Verified ChatGPT authorization and token lifecycle
desktop/store.mjs           Compatible SQLite records and imports
lms-agent/src/browser/      Moodle readers, folder files and bounded PPTX extraction
test/ and scripts/         Unit, browser, native and live checks
```

## License

A project license has not been selected. Public source availability alone does not grant an open-source license.
