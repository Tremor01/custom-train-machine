import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { staticContentType } from '../../server/static-content.js';
import { isPathInside } from '../../server/static-content.js';

test('serves HTML entrypoint with a browser-renderable content type', () => {
  assert.equal(staticContentType('index.html'), 'text/html; charset=utf-8');
});

test('recognizes children and rejects traversal for POSIX and Windows paths', () => {
  for (const paths of [path.posix, path.win32]) {
    const root = paths.resolve(paths.sep === '\\' ? 'C:\\app\\dist' : '/app/dist');
    assert.equal(isPathInside(root, paths.join(root, 'assets', 'app.js'), paths), true);
    assert.equal(isPathInside(root, paths.resolve(root, '..', 'secret.txt'), paths), false);
    assert.equal(isPathInside(root, root, paths), false);
  }
});
