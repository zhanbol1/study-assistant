const SECRET_QUERY_KEYS = new Set([
  'sesskey', 'token', 'wstoken', 'key', 'auth', 'authorization', 'password',
]);

export function sanitizeUrl(rawUrl, baseUrl) {
  try {
    const url = new URL(rawUrl, baseUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function cleanText(value, maxLength = 300) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
