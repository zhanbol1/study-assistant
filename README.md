# Study Assistant

A planned desktop study assistant for tracking homework, exams, and study materials, starting with Windows and designed for future macOS and Linux support.

## Current state

The repository currently contains [`lms-agent`](lms-agent/README.md), a local Node.js and Playwright tool for Moodle discovery, course and assignment listing, activity listing, and resource downloads. It also provides a local authenticated bridge.

The desktop interface, AI integration, deadline extraction, reminders, document search, and teachable routines are planned and are not yet implemented.

## Planned direction

- Electron, React, and TypeScript for the desktop application.
- A local Node.js worker that reuses the existing Moodle automation.
- SQLite for courses, deadlines, routines, preferences, and synchronization history.
- AI provider adapters, beginning with supported ChatGPT plan integration and API-key access.
- Study assistance grounded in collected course materials, with source references.
- Guided routines that users can demonstrate, review, and save.

Provider availability, authentication requirements, and usage limits must be verified during implementation.

## Get started

See the [LMS agent README](lms-agent/README.md) for Windows prerequisites, setup, commands, and current limitations.

Run its existing tests:

```powershell
cd lms-agent
npm.cmd test
```

## Private local data

Do not commit credentials, API keys, bridge tokens, browser profiles, downloaded course materials, or discovery artifacts. Dependency folders, local browser binaries, and the existing agent's downloads and artifacts are excluded by Git ignore rules.

## License

A project license has not yet been selected. Public source availability alone does not grant an open-source license.
