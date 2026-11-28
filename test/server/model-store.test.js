import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModelStore } from '../../server/model-store.js';

test('publishes model manifest atomically and tracks active model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ctm-models-'));
  try {
    const store = createModelStore(root);
    const modelId = await store.publish({ classes: [{ name: 'A' }, { name: 'B' }] }, async directory => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(directory, 'model.json'), '{}');
    });
    assert.equal((await store.readManifest(modelId)).classes.length, 2);
    assert.equal(await store.activeId(), modelId);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed active-pointer rename rejects and leaves the existing pointer entry untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ctm-active-rename-'));
  const store = createModelStore(root);
  try {
    const previous = await store.publish({ classes: [{ name: 'old' }] }, async directory => {
      await writeFile(join(directory, 'model.json'), '{}');
      await writeFile(join(directory, 'weights.bin'), 'old');
    });
    const next = await store.publish({ classes: [{ name: 'new' }] }, async directory => {
      await writeFile(join(directory, 'model.json'), '{}');
      await writeFile(join(directory, 'weights.bin'), 'new');
    });
    const activeFile = join(root, 'active.json');
    const activeContents = await import('node:fs/promises').then(fs => fs.readFile(activeFile, 'utf8'));
    await rm(activeFile);
    await mkdir(activeFile);
    await writeFile(join(activeFile, 'pointer'), activeContents);
    await assert.rejects(store.activate(next), error => ['EISDIR', 'EPERM', 'EEXIST'].includes(error.code));
    assert.equal(await import('node:fs/promises').then(fs => fs.readFile(join(activeFile, 'pointer'), 'utf8')), activeContents);
    assert.notEqual(await import('node:fs/promises').then(fs => fs.readFile(join(root, `.active-${next}.tmp`), 'utf8').catch(() => null)), JSON.stringify({ id: previous }));
    assert.equal(previous.length, 36);
  } finally { await rm(root, { recursive: true, force: true }); }
});
