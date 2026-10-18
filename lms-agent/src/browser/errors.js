const messages = {
  'network-timeout': 'Moodle did not respond in time. Try again shortly; this does not mean your credentials are wrong.',
  'network-error': 'Moodle could not be reached. Check your network or VPN and try again.',
  'page-not-ready': 'Moodle opened, but its page content did not finish loading. Try again shortly.',
  'login-rejected': 'Moodle rejected the saved login. Update it with npm run credentials:set in the project terminal.',
  'login-incomplete': 'Moodle sign-in did not complete. SSO or MFA may require an interactive login.',
  'login-external': 'Moodle redirected to an external sign-in provider. Automatic password login cannot complete that flow.',
  'courses-not-loaded': 'Moodle did not load the course overview. No courses were marked missing. Retry or check the overview in Moodle.',
  'course-unavailable': 'Moodle did not open the requested course. It may be unavailable or your session may have expired.',
};
export class MoodleError extends Error {
  constructor(code, message = messages[code]) { super(message || 'Moodle could not be read.'); this.name = 'MoodleError'; this.code = code; this.retryable = ['network-timeout', 'network-error', 'page-not-ready', 'courses-not-loaded', 'server-unavailable'].includes(code); }
}
export function safeMoodleError(error) {
  const value = String(error?.message || '');
  if (error instanceof MoodleError) return { code: error.code, message: error.message, retryable: ['network-timeout', 'network-error', 'page-not-ready', 'courses-not-loaded', 'server-unavailable'].includes(error.code) };
  if (error?.name === 'PresentationReadError') return { code: 'presentation-unreadable', message: value, retryable: false };
  if (/No LMS credentials/.test(value)) return { code: 'credentials-missing', message: 'No Moodle credentials are stored. Run npm run credentials:set in the project terminal.', retryable: false };
  if (/Executable doesn't exist|Cannot find package|Cannot find module/.test(value)) return { code: 'browser-missing', message: 'Moodle dependencies or Chromium are missing. Run npm run lms:install and npm run lms:browser.', retryable: false };
  if (/credential/i.test(value)) return { code: 'credential-storage', message: 'The stored Moodle login could not be read. Run the app under the Windows account that saved it, or reconnect with npm run credentials:set.', retryable: false };
  if (error?.name === 'TimeoutError' || /timeout|timed out/i.test(value)) return { code: 'page-not-ready', message: messages['page-not-ready'], retryable: true };
  if (/net::|ENOTFOUND|ECONNRESET|ECONNREFUSED/.test(value)) return { code: 'network-error', message: messages['network-error'], retryable: true };
  return { code: 'read-failed', message: 'Moodle could not complete this read. Try again or check the course directly in Moodle.', retryable: false };
}
