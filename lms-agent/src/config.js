import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

export const config = Object.freeze({
  baseUrl: 'https://ucasaslms.org/',
  coursesUrl: 'https://ucasaslms.org/my/courses.php',
  downloadsDir: path.join(process.env.LMS_DATA_DIR || projectRoot, 'downloads'),
  artifactsDir: path.join(process.env.LMS_DATA_DIR || projectRoot, 'artifacts'),
  headless: process.env.LMS_HEADLESS !== 'false',
  timeoutMs: 30_000,
});
