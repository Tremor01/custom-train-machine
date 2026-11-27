import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { Worker } from 'node:worker_threads';
import { createMlService } from '../../server/ml-service.js';

test('real worker trains, saves, activates and predicts using generated images', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ctm-worker-roundtrip-'));
  const modelDirectory = join(directory, 'published');
  const stagingDirectory = join(directory, 'staging');
  const classes = [];
  for (let classIndex = 0; classIndex < 2; classIndex++) {
    const examples = [];
    for (let index = 0; index < 3; index++) {
      const path = join(directory, `${classIndex}-${index}.png`);
      await sharp({ create: { width: 16, height: 16, channels: 3, background: classIndex ? { r: 235, g: 25 + index, b: 25 } : { r: 25, g: 25 + index, b: 235 } } }).png().toFile(path);
      examples.push(path);
    }
    classes.push({ name: `class-${classIndex}`, color: '#123456', emoji: 'x', sound: '', examples });
  }

  const service = createMlService();
  try {
    const progress = [];
    const manifest = await service.train({ classes, modelDirectory, stagingDirectory }, value => progress.push(value));
    assert.equal(manifest.metrics.length, 25);
    assert.ok(manifest.metrics.at(-1).accuracy > 0.5, `expected separable generated colors to train above chance; got ${manifest.metrics.at(-1).accuracy}`);
    assert.equal(manifest.validation.actual.length, 2);
    assert.equal(manifest.validation.predicted.length, 2);
    assert.ok(manifest.validation.actual.every(index => Number.isInteger(index) && index >= 0 && index < classes.length));
    assert.ok(manifest.validation.predicted.every(index => Number.isInteger(index) && index >= 0 && index < classes.length));
    assert.ok(progress.some(value => value.phase === 'training' && value.progress === 100));
    assert.ok((await readFile(join(stagingDirectory, 'weights.bin'))).length > 0);
    const savedManifest = JSON.parse(await readFile(join(stagingDirectory, 'manifest.json'), 'utf8'));
    assert.deepEqual(savedManifest.validation, manifest.validation);
    await mkdir(modelDirectory, { recursive: true });
    await writeFile(join(modelDirectory, 'model.json'), await readFile(join(stagingDirectory, 'model.json')));
    await writeFile(join(modelDirectory, 'weights.bin'), await readFile(join(stagingDirectory, 'weights.bin')));
    await service.activateModel({ modelPath: join(modelDirectory, 'model.json'), modelDirectory, classes });
    const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 235, g: 25, b: 25 } } }).png().toBuffer();
    const prediction = await service.predict({ image });
    assert.deepEqual(prediction.classes.map(item => item.name), ['class-0', 'class-1']);
    assert.equal(prediction.probabilities.length, 2);
    assert.ok(prediction.probabilities.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.ok(Math.abs(prediction.probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-5);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('repeated real-worker predictions do not increase the live tensor count', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ctm-worker-tensors-'));
  const classes = [];
  for (let classIndex = 0; classIndex < 2; classIndex++) {
    const examples = [];
    for (let index = 0; index < 3; index++) {
      const path = join(directory, `${classIndex}-${index}.png`);
      await sharp({ create: { width: 16, height: 16, channels: 3, background: classIndex ? { r: 235, g: 25, b: 25 } : { r: 25, g: 25, b: 235 } } }).png().toFile(path);
      examples.push(path);
    }
    classes.push({ name: `class-${classIndex}`, color: '#123456', emoji: 'x', sound: '', examples });
  }
  const worker = new Worker(new URL('../../server/training-worker.js', import.meta.url), { type: 'module', workerData: { testTensorStats: true } });
  const service = createMlService({ workerFactory: () => worker });
  try {
    const stagingDirectory = join(directory, 'staging');
    await service.train({ classes, modelDirectory: join(directory, 'published'), stagingDirectory });
    await service.activateModel({ modelPath: join(stagingDirectory, 'model.json'), modelDirectory: stagingDirectory, classes });
    const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 235, g: 25, b: 25 } } }).png().toBuffer();
    const tensorCount = () => new Promise((resolve, reject) => {
      const id = `tensor-count-${Math.random()}`;
      const onMessage = message => { if (message.id === id) { worker.off('message', onMessage); message.type === 'result' ? resolve(message.result) : reject(new Error(message.error)); } };
      worker.on('message', onMessage);
      worker.postMessage({ id, type: '__test-tensor-count' });
    });
    const baseline = await tensorCount();
    for (let i = 0; i < 3; i++) await service.predict({ image });
    assert.equal(await tensorCount(), baseline, 'prediction tensors should be disposed after each inference');
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
