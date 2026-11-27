import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
