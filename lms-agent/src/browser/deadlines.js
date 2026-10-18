// Parse only explicit dates. Ambiguous numeric and relative dates stay unknown.
const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function parseMoodleDate(value, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (typeof value !== 'string') return '';
  const source = value.trim();
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d:\d\d)$/.test(source)) {
    const [year, month, day] = source.slice(0, 10).split('-').map(Number);
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return '';
    const time = Date.parse(source);
    return Number.isFinite(time) ? new Date(time).toISOString() : '';
  }
  const match = source.match(/(?:^|\b)(\d{1,2})\s+([a-z]+)\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?:\s*(am|pm))?\s*$/i);
  if (!match) return '';
  const month = months.findIndex(name => name === match[2].toLowerCase() || name.slice(0, 3) === match[2].toLowerCase());
  let hour = Number(match[4]);
  if (match[6]) {
    if (hour < 1 || hour > 12) return '';
    hour = hour % 12 + (match[6].toLowerCase() === 'pm' ? 12 : 0);
  }
  const parts = [Number(match[3]), month + 1, Number(match[1]), hour, Number(match[5])];
  if (month < 0 || hour > 23 || parts[4] > 59) return '';
  const naive = Date.UTC(parts[0], month, parts[2], hour, parts[4]);
  if (new Date(naive).getUTCDate() !== parts[2]) return '';
  let format;
  try {
    format = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } catch { return ''; }
  const offsets = new Set();
  for (const delta of [-36, 0, 36]) {
    const probe = naive + delta * 3600000;
    const p = Object.fromEntries(format.formatToParts(probe).map(part => [part.type, part.value]));
    offsets.add(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - probe);
  }
  const candidates = [...offsets].map(offset => naive - offset).filter(candidate => {
    const p = Object.fromEntries(format.formatToParts(candidate).map(part => [part.type, part.value]));
    return [+p.year, +p.month, +p.day, +p.hour, +p.minute].every((part, index) => part === parts[index]);
  });
  return candidates.length === 1 ? new Date(candidates[0]).toISOString() : '';
}

export function deadlineDetails(entries, timeZone) {
  const result = { dueAt: '', opensAt: '', deadlineEvidence: '', deadlineTimeZone: timeZone };
  const closingDates = new Set();
  for (const entry of entries) {
    const label = String(entry.label || '').replace(/\s+/g, ' ').trim();
    const closing = /^(due(?: date)?|closes?|closed|quiz closes?)\s*:?$/i.test(label);
    const opening = /^(opens?|opened|quiz opens?)\s*:?$/i.test(label);
    if (!closing && !opening) continue;
    let date = '';
    if (/^\d{10,11}$/.test(String(entry.timestamp || ''))) {
      const time = Number(entry.timestamp) * 1000;
      if (time > 0 && time < Date.UTC(2200, 0)) date = new Date(time).toISOString();
    }
    date ||= parseMoodleDate(entry.datetime || entry.value || '', timeZone);
    if (closing) {
      if (date) closingDates.add(date);
      if (date || !result.deadlineEvidence) {
        result.dueAt = date;
        result.deadlineEvidence = `${label}: ${entry.value || entry.datetime || entry.timestamp || ''}`.slice(0, 1000);
      }
    } else result.opensAt = date;
  }
  if (closingDates.size > 1) {
    result.dueAt = '';
    result.deadlineEvidence = 'Conflicting explicit dates were displayed. Check the source in Moodle.';
  }
  return result;
}

// Shared between production Playwright reads and offline fixture tests.
export function extractDetailDom() {
  const entries = [];
  for (const row of document.querySelectorAll('.submissionstatustable tr, .quizinfo tr, .generaltable tr')) {
    const cells = row.querySelectorAll('th, td');
    if (cells.length >= 2) entries.push({ label: cells[0].textContent, value: cells[1].textContent,
      datetime: cells[1].querySelector('time')?.getAttribute('datetime'), timestamp: cells[1].querySelector('[data-timestamp]')?.getAttribute('data-timestamp') });
  }
  for (const row of document.querySelectorAll('[data-region="activity-dates"] > div, .activity-dates > div, .quizinfo p')) {
    const strong = row.querySelector('strong');
    if (!strong) continue;
    entries.push({ label: strong.textContent, value: row.textContent.slice(strong.textContent.length).trim(),
      datetime: row.querySelector('time')?.getAttribute('datetime'), timestamp: row.querySelector('[data-timestamp]')?.getAttribute('data-timestamp') });
  }
  const attemptStates = [];
  for (const table of document.querySelectorAll('.quizattemptsummary')) {
    const rows = [...table.querySelectorAll('tr')];
    const headers = [...(rows[0]?.querySelectorAll('th,td') || [])];
    const column = headers.findIndex(cell => /^(state|status)$/i.test(cell.textContent.trim()));
    if (column >= 0) for (const row of rows.slice(1)) {
      const cell = row.querySelectorAll('th,td')[column];
      if (cell) attemptStates.push(cell.textContent);
    }
  }
  return { entries, attemptStates, description: document.querySelector('#intro')?.textContent || '',
    login: Boolean(document.querySelector('input[name="password"]')),
    content: Boolean(document.querySelector('#region-main')) };
}
