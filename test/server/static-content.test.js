import test from 'node:test';
import assert from 'node:assert/strict';
import { staticContentType } from '../../server/static-content.js';

test('serves HTML entrypoint with a browser-renderable content type', () => {
  assert.equal(staticContentType('index.html'), 'text/html; charset=utf-8');
});
