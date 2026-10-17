import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeUrl } from '../src/security/sanitize.js';
import { sanitizeDiscovery } from '../src/browser/discover.js';
import { cleanCourseName, normalizeCourses } from '../src/browser/courses.js';
import { normalizeAssignments } from '../src/browser/assignments.js';
import { normalizeActivities } from '../src/browser/activities.js';

test('sanitizeUrl removes secret query parameters and fragments', () => {
  const result = sanitizeUrl('https://ucasaslms.org/a?id=42&sesskey=secret&token=x#part');
  assert.equal(result, 'https://ucasaslms.org/a?id=42');
});

test('activity normalization exposes only same-site Moodle modules', () => {
  assert.deepEqual(normalizeActivities([
    { title: 'Lecture 1 File', section: 'Week 5', href: '/mod/resource/view.php?id=501' },
    { title: 'External', section: 'Week 5', href: 'https://example.com/mod/resource/view.php?id=9' },
  ]), [{
    id: '501', type: 'resource', title: 'Lecture 1', section: 'Week 5',
    url: 'https://ucasaslms.org/mod/resource/view.php?id=501',
  }]);
});

test('course names remove Moodle accessibility boilerplate and duplication', () => {
  assert.equal(
    cleanCourseName('Course is starred Course name Discrete Mathematics Discrete Mathematics'),
    'Discrete Mathematics',
  );
});

test('assignment normalization accepts only same-site assignment routes', () => {
  assert.deepEqual(normalizeAssignments([
    { title: 'Homework 1 Assignment', section: 'Week 1', href: '/mod/assign/view.php?id=99' },
    { title: 'Bad', href: 'https://example.com/mod/assign/view.php?id=2' },
  ]), [{
    id: '99', title: 'Homework 1', section: 'Week 1',
    url: 'https://ucasaslms.org/mod/assign/view.php?id=99',
  }]);
});

test('course normalization keeps only Moodle course routes and deduplicates cards', () => {
  const courses = normalizeCourses([
    { text: 'Course', href: 'https://ucasaslms.org/course/view.php?id=42' },
    { text: 'Applied Mathematics', href: 'https://ucasaslms.org/course/view.php?id=42' },
    { text: 'External', href: 'https://example.com/course/view.php?id=7' },
    { text: 'Profile', href: 'https://ucasaslms.org/user/profile.php?id=42' },
  ]);
  assert.deepEqual(courses, [{
    id: '42',
    name: 'Applied Mathematics',
    url: 'https://ucasaslms.org/course/view.php?id=42',
  }]);
});

test('discovery never includes form values and masks sensitive names', () => {
  const result = sanitizeDiscovery({
    title: 'Courses',
    headings: [],
    links: [],
    forms: [{
      action: '/login/index.php?sesskey=secret',
      method: 'post',
      fields: [{ name: 'password', type: 'password', label: 'Password', value: 'never' }],
    }],
  }, 'https://ucasaslms.org/my/courses.php');

  assert.equal(result.forms[0].action, 'https://ucasaslms.org/login/index.php');
  assert.equal(result.forms[0].fields[0].name, '[sensitive-field]');
  assert.equal('value' in result.forms[0].fields[0], false);
});
