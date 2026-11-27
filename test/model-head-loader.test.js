import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerHead } from '../src/model-head-loader.js';

test('loads model shards for local inference without requiring authentication helpers', async () => {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/model.json')) return { ok: true, json: async () => ({ modelTopology: {}, weightsManifest: [{ paths: ['/api/models/model-1/weights.bin'], weights: [{ name: 'dense/kernel', shape: [1280, 2], dtype: 'float32' }] }] }) };
    return { ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
  };
  const tf = { io: { fromMemory: artifacts => artifacts }, loadLayersModel: async artifacts => artifacts };

  const loaded = await loadServerHead({ modelId: 'model-1', fetch, tf });

  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, '/api/models/model-1/weights.bin');
  assert.deepEqual(requests[1].options, undefined);
  assert.equal(loaded.weightSpecs[0].name, 'dense/kernel');
  assert.deepEqual(Array.from(new Uint8Array(loaded.weightData)), [1, 2, 3]);
});
