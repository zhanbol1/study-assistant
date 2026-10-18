# UCA LMS Agent

The Moodle backend for [Study Assistant](../README.md), with standalone discovery commands and an optional local bridge for `https://ucasaslms.org/`. Playwright performs browser actions, and Windows Credential Manager stores LMS credentials at rest. The desktop app calls the backend directly; it does not require the bridge. No upload or assignment-submission commands are provided.

## Security boundary

- A local PowerShell helper retrieves credentials from Windows Credential Manager and passes plaintext JSON through a private stdout pipe to the Node process for login.
- The public CLI and bridge do not intentionally log or return credential values. The internal credential helper's `get` action returns credentials: never run it manually or forward its output to chat or logs.
- Discovery never extracts form values, cookies, browser storage, request headers, or response bodies.
- Known secret URL parameters and fragments are removed from discovery output.
- Upload and submission tools are intentionally not implemented in this phase.

## Setup

Requires Windows, PowerShell, Node.js 22 or newer, and npm. Run these commands from the parent directory of `lms-agent`:

```powershell
cd lms-agent
npm.cmd install
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.playwright-browsers"
npx.cmd playwright install chromium
npm.cmd run credentials:set
```

The credential command prompts locally. Do not paste credentials into chat.

## Run read-only discovery

```powershell
npm.cmd run discover
```

Run the remaining commands from `lms-agent`. In each new terminal used for direct discovery or course listing, set `PLAYWRIGHT_BROWSERS_PATH` to the same browser installation directory.

Set `LMS_HEADLESS=false` to show the browser and allow manual interaction during login:

```powershell
$env:LMS_HEADLESS = 'false'
npm.cmd run discover
```

Login automation recognizes URLs containing `/login` and common username/password fields. After submitting credentials, it waits up to 45 seconds for navigation away from `/login` or a visible login error. It waits for relevant Moodle content rather than unrelated images or the full page-load event. External sign-in redirects are rejected before credentials are filled; SSO/MFA flows are not generally supported. Showing the browser does not make unsupported authentication flows work automatically.

Sanitized output is written to `artifacts/discovery.json`. Treat assignment and course names in that file as private educational data.

The desktop app sets `LMS_DATA_DIR` so its worker writes `artifacts/` and `downloads/` under the app's private data directory instead of this project. Standalone commands retain the paths above unless you set that variable yourself.

List courses visible in the Moodle course overview:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.playwright-browsers"
npm.cmd run courses
```

Discovery is not a prerequisite for course listing. Standalone commands start fresh browser sessions; login sessions are not persisted between commands. The desktop worker enables in-memory session reuse with `LMS_REUSE_SESSION=true` and closes it after ten idle minutes, cancellation, failure or app exit. Changed credentials invalidate the shared browser. Course listing reads the rendered overview without navigating pagination or changing filters, so it may not include every enrolled course.

## Remove stored credentials

```powershell
npm.cmd run credentials:delete
```

## Run the desktop bridge for Codex

When Codex runs under a Windows identity that cannot access your desktop account's stored credentials, start this loopback-only bridge from your own terminal under the account that stored them:

```powershell
npm.cmd run bridge:start
```

Keep that terminal open. The startup script sets `PLAYWRIGHT_BROWSERS_PATH` to the project's `.playwright-browsers` directory. The bridge binds to `127.0.0.1:43127` and requires a local bearer token. It generates a random token when no valid token file exists and reuses it from `.bridge-token` on subsequent starts. Treat that file as a secret: anyone able to read it and reach the bridge can invoke its operations.

The bridge exposes health, course listing, assignment listing, activity listing, and resource downloads. Its responses do not intentionally include LMS credentials, cookies, or browser storage.

Check bridge health and list courses from another terminal:

```powershell
npm.cmd run bridge:health
npm.cmd run bridge:courses
```

The read-only bridge supports listing assignments for a numeric course ID:

```powershell
node src/bridge/client.js assignments 1217
```

It can also enumerate course activities and download a resource that belongs to that course:

```powershell
node src/bridge/client.js activities 1217
node src/bridge/client.js download 1217 501
```

Replace the example IDs with a course ID returned by course listing and an activity ID returned by activity listing. Assignment listing returns titles, sections, and links found on the course page; it does not retrieve assignment details or submissions.

The desktop chat's `get_coursework` tool uses a separate coursework reader. It reads assignment and quiz detail pages, descriptions, explicit deadlines, quiz availability windows, and available submission/attempt-status evidence. It supports machine timestamps and explicit English dates interpreted in the Moodle time zone configured beneath chat. Uncertain dates and missing completion evidence remain unknown. It never submits work or starts a quiz attempt. There is no manual Import coursework section in the current UI. The standalone assignment-listing command retains its title/section/link response.

The bridge download command accepts Moodle `resource` or `folder` activities discovered in the selected course. The desktop additionally lists individual folder files and introductory assignment/quiz attachments. Folder downloads request a ZIP archive; resource downloads follow redirects only within the configured Moodle origin. An HTML page without an attachment disposition is rejected instead of being saved as a document. This does not establish that every downloaded file is valid; PPTX parsing performs separate archive and XML checks.

Files are saved under `downloads/`, with the activity ID and a random suffix prefixed to a sanitized filename. New downloads do not overwrite existing files. In the desktop's shared browser context, valid local copies can be reused after an authenticated conditional request confirms an unchanged ETag or Last-Modified value. File size and SHA-256 are checked before reuse. Changes, missing local copies and contexts without a cached record require another download.

Each transfer attempt has a 60-second timeout, with one retry for transient failures. Responses larger than 100 MiB (104,857,600 bytes) are rejected before saving. The request API buffers the response before the size checks, so this is not a network-transfer or memory-use limit. The desktop exposes distinct errors for login rejection, page-loading failure, server errors and file-transfer timeouts.

The desktop `read_slides` tool reads individual PPTX files, including files inside Moodle folders. It extracts text and speaker notes with slide-number references and paginated responses. It does not interpret slide images, extract folder ZIP contents, or read PDF, Word or legacy PPT formats. See the parent README for limits, Memory instructions and example prompts.

"Read-only" means the app provides no course-editing, upload, or submission operations. It still signs in, opens Moodle pages, and writes local discovery artifacts and downloaded files; Moodle may record login, access, or activity-completion events.

## Tests

```powershell
npm.cmd test
```

This directory's unit tests cover URL sanitization, discovery output filtering, and course, assignment, and activity normalization. Run the broader checks from the repository root:

```powershell
npm.cmd test
npm.cmd run test:coursework
npm.cmd run test:moodle:offline
```

Root tests also cover worker and browser reuse, cancellation, credential changes, conditional downloads, revoked access, file integrity and PPTX extraction. Browser fixtures check session expiry, delayed content, login errors and download retries without using a real account. These checks do not establish that live Moodle, external SSO/MFA or the optional bridge will work in every environment. Account-connected checks are documented in the parent README.
