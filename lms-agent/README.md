# UCA LMS Agent

Local Moodle discovery, course browsing, and resource downloads for `https://ucasaslms.org/`, controlled by Codex. Playwright performs browser actions, and Windows Credential Manager stores LMS credentials at rest. The app has no upload or assignment-submission commands.

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

Login automation recognizes URLs containing `/login` and common username/password fields. After submitting credentials, it waits up to 60 seconds for the URL to leave `/login`. SSO and MFA flows may require interaction and are not generally supported by these checks.

Sanitized output is written to `artifacts/discovery.json`. Treat assignment and course names in that file as private educational data.

List courses visible in the Moodle course overview:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.playwright-browsers"
npm.cmd run courses
```

Discovery is not a prerequisite for course listing. Each browser operation starts a fresh browser session and authenticates as needed; login sessions are not persisted between commands. Course listing reads the rendered overview without navigating pagination or changing filters, so it may not include every enrolled course.

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

Downloads accept only Moodle `resource` or `folder` activities found in the selected course. Folder downloads request a ZIP archive; resource downloads request the activity URL and follow redirects. The app saves the response body without validating that it is the intended file, so a resource page may be saved as HTML instead of its linked document.

Files are saved under `downloads/`, with the activity ID prefixed to a sanitized filename. Repeating a download with the same filename overwrites the existing local file. Responses larger than 100 MiB (104,857,600 bytes) are rejected before saving, but only after the entire response has been downloaded into memory. This is not a network-transfer or memory-use limit.

"Read-only" means the app provides no course-editing, upload, or submission operations. It still signs in, opens Moodle pages, and writes local discovery artifacts and downloaded files; Moodle may record login, access, or activity-completion events.

## Tests

```powershell
npm.cmd test
```

The current tests cover URL sanitization, discovery output filtering, and course, assignment, and activity normalization. They do not verify live LMS login, SSO/MFA, bridge authentication, or downloads.
