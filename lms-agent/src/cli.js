#!/usr/bin/env node
import { discoverLms } from './browser/discover.js';
import { listCourses } from './browser/courses.js';

const command = process.argv[2];

if (!['discover', 'courses'].includes(command)) {
  console.error('Usage: node src/cli.js <discover|courses>');
  process.exitCode = 2;
} else {
  try {
    if (command === 'discover') {
      const { result, outputPath } = await discoverLms();
      console.log(JSON.stringify({
        ok: true,
        page: result.page,
        headings: result.headings.length,
        links: result.links.length,
        forms: result.forms.length,
        artifact: outputPath,
      }, null, 2));
    } else {
      const courses = await listCourses();
      console.log(JSON.stringify({ ok: true, courses }, null, 2));
    }
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
