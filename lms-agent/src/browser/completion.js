export function completionDetails(entries = [], attemptStates = []) {
  const entry = entries.find(item => /^submission status\s*:?$/i.test(String(item.label || '').trim()));
  const evidence = String(entry?.value || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (entry) {
    let status = 'unknown';
    if (/\bsubmitted for grading\b/i.test(evidence)) status = 'submitted';
    else if (/\bno submissions?\b|\bnot submitted\b|\bnothing (?:has been )?submitted\b/i.test(evidence)) status = 'not_submitted';
    else if (/\bdraft\b/i.test(evidence)) status = 'draft';
    return { submissionStatus: status, completionEvidence: evidence };
  }
  const states = attemptStates.map(value => String(value).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const status = states.some(value => /^in progress\b/i.test(value)) ? 'in_progress' : states.some(value => /^finished\b/i.test(value)) ? 'attempt_finished' : 'unknown';
  return { submissionStatus: status, completionEvidence: states.join('; ').slice(0, 1000) };
}
