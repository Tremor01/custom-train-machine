import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import * as tf from '@tensorflow/tfjs';
import { loadExtractor } from '../src/model-loader.js';

test('local MobileNet manifest and all weight files are available', async () => {
  const dir = new URL('../public/models/mobilenet/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('model.json', dir), 'utf8'));
  assert.ok(manifest.modelTopology);
  assert.ok(manifest.weightsManifest.length > 0);
  for (const group of manifest.weightsManifest) for (const file of group.paths) {
    assert.ok((await stat(join(dir.pathname.replace(/^\/(\w:)/, '$1'), file))).size > 0);
  }
});

test('local model loads and returns an embedding', { timeout: 120000 }, async () => {
  const dir = new URL('../public/models/mobilenet/', import.meta.url);
  const server = createServer(async (req, res) => {
    try { res.end(await readFile(new URL(req.url.slice(1), dir))); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let model, image, output;
  try {
    const events = [];
    model = await loadExtractor(`http://127.0.0.1:${server.address().port}/model.json`, event => events.push(event));
    assert.equal(events[0].stage, 'reading');
    assert.ok(events.some(event => event.stage === 'reading' && event.fraction > 0));
    assert.equal(events.at(-1).stage, 'preparing');
    image = tf.zeros([224, 224, 3]);
    output = model.infer(image, true);
    assert.deepEqual(output.shape, [1, 1280]);
  } finally {
    output?.dispose(); image?.dispose(); model?.model.dispose();
    await new Promise(resolve => server.close(resolve));
  }
});
